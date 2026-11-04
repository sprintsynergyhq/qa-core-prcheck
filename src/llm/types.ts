// Types for the optional LLM ranking (PR 8). The LLM is advisory: it may only re-order and annotate the
// specs the rules picked and the suggestions the rules made. It never adds, removes or runs a spec.

export const PROVIDER_NAMES = ['none', 'anthropic', 'openai', 'gemini'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];
export type LlmProvider = Exclude<ProviderName, 'none'>;

/**
 * The only env var the API key is read from. The config file cannot name another one, because the
 * config comes from the pull request under check, which could then choose which env var is sent.
 */
export const DEFAULT_API_KEY_ENV = 'PRCHECK_LLM_API_KEY';

export interface LlmConfig {
  provider: ProviderName;       // default "none": no call is ever made
  model: string | null;         // required unless provider is "none"; null when not set
}

export interface RankedSpec { file: string; note: string }
export interface RankedSuggestion { index: number; note: string }

/**
 * The result of one ranking attempt. applied: specs lists every picked spec file once, in the LLM
 * order, and suggestions lists every shown suggestion index once (an index into the suggestions the
 * summary shows), in the LLM order. skipped: the reason, already free of the key.
 */
export type Ranking =
  | { status: 'applied'; provider: LlmProvider; model: string; specs: RankedSpec[]; suggestions: RankedSuggestion[] }
  | { status: 'skipped'; provider: LlmProvider; model: string; reason: string };

/** One HTTP request to a provider, built by an adapter. */
export interface LlmRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A provider adapter: a pure request builder and a pure reader of the answer text. */
export interface LlmAdapter {
  provider: LlmProvider;
  origin: string;               // the fixed documented HTTPS origin; a request anywhere else is refused
  buildRequest(model: string, key: string, instruction: string, data: string): LlmRequest;
  /** The answer text from a 2xx JSON body, or an LlmError with a short reason. */
  readAnswer(json: unknown): string;
}

/** An expected LLM failure. The message is a short reason that never holds the key or the answer. */
export class LlmError extends Error {}
