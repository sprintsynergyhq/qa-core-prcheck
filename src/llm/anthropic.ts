// Anthropic Messages API, read 2026-10-30:
// - https://platform.claude.com/docs/en/api/overview: POST https://api.anthropic.com/v1/messages;
//   "Authorization | Bearer <key>, where <key> is your API key or a short-lived access token ... | Yes, unless
//   x-api-key is set"; "anthropic-version | API version (for example, 2026-10-21) | Yes".
// - https://platform.claude.com/docs/en/api/versioning: 2026-10-21 is the latest version; it rejects
//   temperature, top_p and top_k with a 400, and none of them is sent.
// - https://platform.claude.com/docs/en/api/messages: model, max_tokens, system, messages; the answer is
//   content[] blocks of type "text", and stop_reason "end_turn" is a whole answer.

import { LLM_MAX_OUTPUT_TOKENS } from './prompt.js';
import { LlmError, type LlmAdapter } from './types.js';

export const ANTHROPIC_VERSION = '2026-10-21';
const ORIGIN = 'https://api.anthropic.com';

const word = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(v) ? v : 'unknown');

export const anthropic: LlmAdapter = {
  provider: 'anthropic',
  origin: ORIGIN,
  buildRequest(model, key, instruction, data) {
    return {
      url: `${ORIGIN}/v1/messages`,
      headers: { authorization: `Bearer ${key}`, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: LLM_MAX_OUTPUT_TOKENS, system: instruction, messages: [{ role: 'user', content: data }] }),
    };
  },
  readAnswer(json) {
    const answer = json as { stop_reason?: unknown; content?: unknown } | null;
    const stop = answer?.stop_reason;
    if (stop === 'max_tokens') throw new LlmError('the answer was cut at the output token cap');
    if (stop === 'refusal') throw new LlmError('the model refused to answer');
    if (stop !== 'end_turn') throw new LlmError(`the answer stopped with stop_reason ${word(stop)}`);
    if (!Array.isArray(answer?.content)) throw new LlmError('the answer has no content');
    const texts = answer.content.filter((b: { type?: unknown; text?: unknown }) => b?.type === 'text' && typeof b.text === 'string');
    if (texts.length === 0) throw new LlmError('the answer has no text');
    return texts.map((b: { text: string }) => b.text).join('');
  },
};
