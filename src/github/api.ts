// A small GitHub REST client on Node's built-in fetch. The token goes only into the Authorization header
// of requests to the origin of the API URL, and never into a message.
//
// Docs used:
// - Headers and versions: https://docs.github.com/en/rest/about-the-rest-api/api-versions
// - Pagination and the link header: https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api
// - Rate limits, 403 or 429, retry-after, x-ratelimit-remaining and x-ratelimit-reset (UTC epoch seconds):
//   https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
// - Server side timeout of 10 seconds: https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api

import { setTimeout as delay } from 'node:timers/promises';
import { VERSION } from '../version.js';
import { GitHubError, type ApiResponse, type GitHubClient } from './types.js';

// The newest version listed in the API versions docs; 2022-11-28 is still supported until 2028-03-10.
export const API_VERSION = '2026-03-10';
// Longest API error message kept, in characters; longer ones are cut and end in "...". A chosen limit.
export const MESSAGE_MAX_CHARS = 200;
// Most pages read for one list, 100 items each. A chosen limit that stops a runaway loop.
export const MAX_PAGES = 50;
// How long one request may take, in ms, before it is stopped. A chosen limit, above the 10 seconds after
// which the troubleshooting docs say GitHub ends a request itself.
export const REQUEST_TIMEOUT_MS = 30_000;
// How often a failed GET or PATCH is tried again, so at most 3 attempts. A chosen limit.
export const MAX_RETRIES = 2;
// The wait before retry n is this times n when GitHub names no wait. A chosen value.
export const RETRY_BACKOFF_MS = 2_000;
// The longest wait before a retry, in ms. A chosen limit: when GitHub asks for longer, the request fails at once.
export const MAX_RETRY_WAIT_MS = 60_000;
// The wait after a rate limited answer that names no wait. From the rate limit docs, not chosen:
// "Otherwise, wait for at least one minute before retrying."
export const RATE_LIMIT_WAIT_MS = 60_000;

// The methods tried again. A POST is sent once: a POST that failed may still have made the comment, and
// the docs do not say whether a rate limited request was processed. upsertStickyComment lists the
// comments again before a second POST.
const RETRIED_METHODS = new Set(['GET', 'PATCH']);
// The words that make a 403 rate limited when no header says so: the API message from the JSON body
// holds rate limit, any case. Tested with RegExp.test only.
const RATE_LIMIT_MESSAGE = /rate limit/i;

// Hosts that may use plain http, so tests can run a fake API on this machine. Everything else needs https.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

export interface ClientOptions {
  token: string;
  apiUrl: string;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;   // for tests; default setTimeout from node:timers/promises
  now?: () => number;                       // for tests; default Date.now
  timeoutMs?: number;                       // for tests; default REQUEST_TIMEOUT_MS
}

function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}...` : line;
}

/** The error code of a failed fetch (for example ECONNREFUSED), never its message or request. */
function causeCode(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  if (typeof cause?.code === 'string') return cause.code;
  return error instanceof Error ? error.name : 'unknown error';
}

/**
 * The wait GitHub asked for, in ms: retry-after seconds, or with x-ratelimit-remaining 0 the time until
 * x-ratelimit-reset, never below 0. Null when neither header names a whole number.
 */
function askedWaitMs(headers: Headers, now: number): number | null {
  const retryAfter = headers.get('retry-after')?.trim();
  if (retryAfter !== undefined && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  const reset = headers.get('x-ratelimit-reset')?.trim();
  if (headers.get('x-ratelimit-remaining')?.trim() === '0' && reset !== undefined && /^\d+$/.test(reset)) {
    return Math.max(0, Number(reset) * 1000 - now);
  }
  return null;
}

/** The same error with the number of attempts added to its message, when there was more than one. */
function withAttempts(error: GitHubError, attempts: number): GitHubError {
  if (attempts === 1) return error;
  const { status, method, rateLimited, retryable, waitMs } = error;
  return new GitHubError(`${error.message} (${attempts} attempts)`, status, { method, rateLimited, retryable, waitMs });
}

/** The API URL as a URL object, or a GitHubError that does not repeat the URL. */
function checkApiUrl(apiUrl: string): URL {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new GitHubError('GITHUB_API_URL is not a valid URL');
  }
  if (url.username !== '' || url.password !== '') throw new GitHubError('GITHUB_API_URL must not hold a user name or password');
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url;
  throw new GitHubError('GITHUB_API_URL must use https (plain http only for 127.0.0.1, ::1 or localhost)');
}

/**
 * A client for the REST API at apiUrl. Every request sends the documented Accept header, the API
 * version, a User-Agent and the token as a Bearer token, and is stopped after timeoutMs. A status
 * outside 200 to 299 throws a GitHubError with the method, the path without its query, the status and
 * the API message. A GET or PATCH is tried again, at most MAX_RETRIES times, after a network error, a
 * timeout, a 5xx, a 429 or a rate limited 403 (a rate limit header, or an API message that says rate
 * limit); the final error says how many attempts were made.
 */
export function createGitHubClient(options: ClientOptions): GitHubClient {
  const { token, fetch: fetchFn } = options;
  const sleep = options.sleep ?? ((ms: number) => delay(ms));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  if (token === '') throw new GitHubError('GITHUB_TOKEN is not set');
  const base = checkApiUrl(options.apiUrl);
  const root = base.href.replace(/\/+$/, '');
  // A second guard: no message can carry the token, even if an API message repeated it.
  const scrub = (text: string): string => text.split(token).join('***');

  async function waitToRetry(error: GitHubError, attempt: number): Promise<void> {
    const ms = error.waitMs ?? (error.rateLimited ? RATE_LIMIT_WAIT_MS : RETRY_BACKOFF_MS * attempt);
    if (ms > MAX_RETRY_WAIT_MS) {
      const { status, method, rateLimited, waitMs } = error;
      const asked = `GitHub asked to wait ${Math.ceil(ms / 1000)} s, longer than the ${MAX_RETRY_WAIT_MS / 1000} s retry limit`;
      throw new GitHubError(`${error.message}. ${asked}`, status, { method, rateLimited, retryable: false, waitMs });
    }
    await sleep(ms);
  }

  /** One attempt, stopped after timeoutMs. */
  async function once(method: string, url: URL, body: unknown): Promise<ApiResponse> {
    const where = `${method} ${url.pathname}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': `qa-core-prcheck/${VERSION}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const signal = AbortSignal.timeout(timeoutMs);
    const timedOut = (): GitHubError => new GitHubError(`GitHub API ${where} timed out after ${timeoutMs} ms`, null, { method, retryable: true });
    let response: Response;
    try {
      response = await fetchFn(url.href, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    } catch (error) {
      if (signal.aborted) throw timedOut();
      throw new GitHubError(`GitHub API ${where} could not be reached: ${causeCode(error)}`, null, { method, retryable: true });
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (signal.aborted) throw timedOut();
      throw new GitHubError(`GitHub API ${where} broke off its answer: ${causeCode(error)}`, response.status, { method, retryable: true });
    }
    let json: unknown = null;
    let validJson = true;
    if (text !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        validJson = false;
      }
    }
    if (response.status < 200 || response.status > 299) {
      const apiMessage = validJson && typeof (json as { message?: unknown } | null)?.message === 'string'
        ? (json as { message: string }).message
        : null;
      const message = apiMessage === null ? '' : `: ${oneLine(scrub(apiMessage), MESSAGE_MAX_CHARS)}`;
      const { status } = response;
      // A 403 is rate limited when a header says so, or when the API message from the JSON body says
      // rate limit (any case). The docs: "If you exceed a secondary rate limit, you will receive a 403 or
      // 429 response and an error message that indicates that you exceeded a secondary rate limit." and
      // "Otherwise, wait for at least one minute before retrying." They give no exact message text, so
      // the rule is the words rate limit; the primary "API rate limit exceeded" matches too. Without a
      // header that names a wait, waitToRetry waits RATE_LIMIT_WAIT_MS.
      // https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
      const rateLimited = status === 429
        || (status === 403 && (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining')?.trim() === '0'
          || (apiMessage !== null && RATE_LIMIT_MESSAGE.test(apiMessage))));
      throw new GitHubError(`GitHub API ${where} failed with status ${status}${message}`, status, {
        method, rateLimited, retryable: rateLimited || status >= 500, waitMs: askedWaitMs(response.headers, now()),
      });
    }
    if (!validJson) throw new GitHubError(`GitHub API ${where} returned a body that is not JSON`, response.status, { method });
    return { status: response.status, json, link: response.headers.get('link') };
  }

  async function request(method: string, target: string, body?: unknown): Promise<ApiResponse> {
    const url = new URL(target.startsWith('/') ? `${root}${target}` : target);
    if (url.origin !== base.origin) throw new GitHubError(`Refusing a ${method} request outside the GitHub API URL`);
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(method, url, body);
      } catch (error) {
        if (!(error instanceof GitHubError)) throw error;
        if (!error.retryable || !RETRIED_METHODS.has(method) || attempt > MAX_RETRIES) throw withAttempts(error, attempt);
        try {
          await waitToRetry(error, attempt);
        } catch (waitError) {
          throw waitError instanceof GitHubError ? withAttempts(waitError, attempt) : waitError;
        }
      }
    }
  }

  return { apiUrl: base.href, request, waitToRetry };
}

/**
 * The rel="next" URL of a link header, or null when there is none or it is on another origin than
 * apiUrl, so a page link can never send the token somewhere else. Pure.
 */
export function parseNextLink(link: string | null, apiUrl: string): string | null {
  if (link === null) return null;
  for (const match of link.matchAll(/<([^>]*)>\s*;\s*rel="([^"]*)"/g)) {
    if (!match[2]!.split(/\s+/).includes('next')) continue;
    try {
      const next = new URL(match[1]!);
      return next.origin === new URL(apiUrl).origin ? next.href : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Every item of a list, following rel="next" links for at most MAX_PAGES pages. */
export async function getAllPages(client: GitHubClient, path: string): Promise<unknown[]> {
  const items: unknown[] = [];
  let target: string | null = path;
  for (let page = 1; target !== null; page++) {
    if (page > MAX_PAGES) throw new GitHubError(`GitHub API GET ${path.split('?')[0]} has more than ${MAX_PAGES} pages`);
    const response = await client.request('GET', target);
    if (!Array.isArray(response.json)) throw new GitHubError(`GitHub API GET ${new URL(target, client.apiUrl).pathname} did not return a list`);
    items.push(...(response.json as unknown[]));
    target = parseNextLink(response.link, client.apiUrl);
  }
  return items;
}
