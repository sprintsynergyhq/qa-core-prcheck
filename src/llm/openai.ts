// OpenAI Responses API, read 2026-10-30 (chosen over Chat Completions, whose page recommends Responses
// for new projects):
// - https://developers.openai.com/api/reference/resources/responses/methods/create: POST
//   https://api.openai.com/v1/responses; model, instructions, input, max_output_tokens (it includes
//   reasoning tokens), store (default true, "stored for at least 30 days", so false is sent).
//   The answer: status "completed"; output[] items of type "message" with output_text content.
// - https://developers.openai.com/api/reference/overview: Authorization: Bearer <key>.

import { LLM_MAX_OUTPUT_TOKENS } from './prompt.js';
import { LlmError, type LlmAdapter } from './types.js';

const ORIGIN = 'https://api.openai.com';

const word = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(v) ? v : 'unknown');

interface Content { type?: unknown; text?: unknown }
interface Item { type?: unknown; content?: unknown }

export const openai: LlmAdapter = {
  provider: 'openai',
  origin: ORIGIN,
  buildRequest(model, key, instruction, data) {
    return {
      url: `${ORIGIN}/v1/responses`,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, instructions: instruction, input: data, max_output_tokens: LLM_MAX_OUTPUT_TOKENS, store: false }),
    };
  },
  readAnswer(json) {
    const answer = json as { status?: unknown; incomplete_details?: { reason?: unknown } | null; output?: unknown } | null;
    if (answer?.status === 'incomplete' && answer.incomplete_details?.reason === 'max_output_tokens') {
      throw new LlmError('the answer was cut at the output token cap');
    }
    if (answer?.status !== 'completed') throw new LlmError(`the answer has status ${word(answer?.status)}`);
    const contents = (Array.isArray(answer.output) ? answer.output as Item[] : [])
      .filter((item) => item?.type === 'message' && Array.isArray(item.content))
      .flatMap((item) => item.content as Content[]);
    if (contents.some((c) => c?.type === 'refusal')) throw new LlmError('the model refused to answer');
    const texts = contents.filter((c) => c?.type === 'output_text' && typeof c.text === 'string');
    if (texts.length === 0) throw new LlmError('the answer has no text');
    return texts.map((c) => c.text as string).join('');
  },
};
