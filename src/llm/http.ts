// One POST to an LLM provider with built-in fetch (Node 22 and later), no SDK. Sources (read 2026-10-30):
// - Anthropic errors, https://platform.claude.com/docs/en/api/errors: 429 rate_limit_error, 500 api_error,
//   529 overloaded_error, a retry-after header on rate limits ("A tier spend-cap 429 has no retry-after header").
// - OpenAI errors, https://developers.openai.com/api/docs/guides/error-codes: 429 and 503, "follow Retry-After when present".
// - Gemini, https://ai.google.dev/gemini-api/docs/troubleshooting: retry 429, 503 and other 5xx, not 400 or 403.
// The key never leaves this module except in the request headers, and every message is scrubbed of it.

import { LlmError, type LlmRequest } from './types.js';

// A chosen limit: one ranking answer is a few KB; room for slow or reasoning models.
export const LLM_TIMEOUT_MS = 60_000;
// A chosen limit: a retry-after above it means no retry, so a CI job fails over to the rules fast.
export const LLM_RETRY_WAIT_MAX_MS = 10_000;
// A chosen value: the wait before the one retry when the provider names no wait.
export const LLM_RETRY_WAIT_DEFAULT_MS = 2_000;
// A chosen limit: a valid answer for 100 specs with 200 character notes is about 30 KB plus the envelope.
export const LLM_MAX_RESPONSE_BYTES = 262_144;
// A chosen limit: one try and one retry.
export const LLM_MAX_ATTEMPTS = 2;
// A chosen limit: the error type text taken from a provider error body.
const ERROR_TYPE_MAX_CHARS = 64;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type SleepLike = (ms: number) => Promise<void>;

export interface PostOptions {
  key: string;
  fetch: FetchLike;
  sleep: SleepLike;
  timeoutMs?: number;
}

interface Failure { reason: string; retryable: boolean; waitMs: number | null }

function causeCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  if (typeof cause?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(cause.code)) return cause.code;
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'unknown error';
}

/** retry-after in whole seconds, as ms; null when absent or not a plain number. */
function retryAfterMs(headers: Headers): number | null {
  const value = headers.get('retry-after')?.trim();
  return value !== undefined && /^\d{1,9}$/.test(value) ? Number(value) * 1000 : null;
}

/** The error type or status name from an error body, only when it is a short plain word. */
function errorType(text: string, scrub: (s: string) => string): string | null {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return null; }
  const error = (json as { error?: Record<string, unknown> } | null)?.error;
  if (error === null || typeof error !== 'object') return null;
  for (const name of ['type', 'status', 'code']) {
    const value = error[name];
    if (typeof value !== 'string') continue;
    const clean = scrub(value);
    if (clean.length <= ERROR_TYPE_MAX_CHARS && /^[A-Za-z0-9_.-]+$/.test(clean)) return clean;
  }
  return null;
}

/** Reads the body up to the byte cap, inside the same abort signal as the request. */
async function readCapped(response: Response): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > LLM_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new LlmError(`the answer is over ${LLM_MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Sends the request at most LLM_MAX_ATTEMPTS times and returns the parsed JSON of a 2xx answer.
 * Throws LlmError with a short reason that holds no key, no header and no answer text.
 */
export async function postJson(request: LlmRequest, options: PostOptions): Promise<unknown> {
  const { key, sleep } = options;
  const timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
  const scrub = (text: string): string => (key === '' ? text : text.split(key).join('***'));
  if (!request.url.startsWith('https://')) throw new LlmError('the provider URL is not HTTPS');

  async function attempt(): Promise<{ json: unknown } | Failure> {
    const signal = AbortSignal.timeout(timeoutMs);
    const timedOut = (): Failure => ({ reason: `the provider did not answer within ${timeoutMs} ms`, retryable: true, waitMs: null });
    let response: Response;
    try {
      // redirect "error": the key is never sent on to another origin.
      response = await options.fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, signal, redirect: 'error' });
    } catch (error) {
      if (signal.aborted) return timedOut();
      return { reason: `the provider could not be reached: ${causeCode(error)}`, retryable: true, waitMs: null };
    }
    let text: string;
    try {
      text = await readCapped(response);
    } catch (error) {
      if (error instanceof LlmError) return { reason: error.message, retryable: false, waitMs: null };
      if (signal.aborted) return timedOut();
      return { reason: `the provider broke off its answer: ${causeCode(error)}`, retryable: true, waitMs: null };
    }
    const status = response.status;
    if (status < 200 || status > 299) {
      const type = errorType(text, scrub);
      const retryable = status === 408 || status === 429 || status >= 500;
      return { reason: `the provider returned status ${status}${type === null ? '' : ` (${type})`}`, retryable, waitMs: retryAfterMs(response.headers) };
    }
    try {
      return { json: JSON.parse(text) };
    } catch {
      return { reason: 'the provider answer is not JSON', retryable: false, waitMs: null };
    }
  }

  for (let n = 1; ; n += 1) {
    const result = await attempt();
    if ('json' in result) return result.json;
    const reason = scrub(result.reason);
    if (!result.retryable) throw new LlmError(reason);
    if (n >= LLM_MAX_ATTEMPTS) throw new LlmError(`${reason} (${n} attempts)`);
    const wait = result.waitMs ?? LLM_RETRY_WAIT_DEFAULT_MS;
    if (wait > LLM_RETRY_WAIT_MAX_MS) {
      throw new LlmError(`${reason} and asked to wait ${Math.ceil(wait / 1000)} s, over the ${LLM_RETRY_WAIT_MAX_MS / 1000} s retry limit`);
    }
    await sleep(wait);
  }
}
