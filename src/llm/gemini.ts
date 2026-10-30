// Gemini generateContent, read 2026-10-30:
// - https://ai.google.dev/api/generate-content: POST
//   https://generativelanguage.googleapis.com/v1beta/{model=models/*}:generateContent; systemInstruction,
//   contents, generationConfig.maxOutputTokens; "store boolean Optional. Configures the logging behavior
//   for a given request. If set, it takes precedence over the project-level logging config." (false is sent).
//   The answer: candidates[0].content.parts[].text, finishReason STOP; promptFeedback.blockReason when blocked.
// - https://ai.google.dev/api: the key goes in the x-goog-api-key header, never in the URL.

import { LLM_MAX_OUTPUT_TOKENS } from './prompt.js';
import { LlmError, type LlmAdapter } from './types.js';

const ORIGIN = 'https://generativelanguage.googleapis.com';

const word = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(v) ? v : 'unknown');

interface Part { text?: unknown; thought?: unknown }
interface Candidate { finishReason?: unknown; content?: { parts?: unknown } }

export const gemini: LlmAdapter = {
  provider: 'gemini',
  origin: ORIGIN,
  buildRequest(model, key, instruction, data) {
    // The model passed config validation (letters, digits and . _ : -), so it is safe in the path.
    return {
      url: `${ORIGIN}/v1beta/models/${model}:generateContent`,
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{ role: 'user', parts: [{ text: data }] }],
        generationConfig: { maxOutputTokens: LLM_MAX_OUTPUT_TOKENS },
        store: false,
      }),
    };
  },
  readAnswer(json) {
    const answer = json as { promptFeedback?: { blockReason?: unknown }; candidates?: unknown } | null;
    const block = answer?.promptFeedback?.blockReason;
    if (block !== undefined) throw new LlmError(`the prompt was blocked (${word(block)})`);
    const candidate = (Array.isArray(answer?.candidates) ? answer.candidates[0] : undefined) as Candidate | undefined;
    if (candidate === undefined) throw new LlmError('the answer has no candidates');
    if (candidate.finishReason === 'MAX_TOKENS') throw new LlmError('the answer was cut at the output token cap');
    if (candidate.finishReason !== 'STOP') throw new LlmError(`the answer stopped with finishReason ${word(candidate.finishReason)}`);
    const parts = Array.isArray(candidate.content?.parts) ? candidate.content.parts as Part[] : [];
    const texts = parts.filter((p) => p?.thought !== true && typeof p?.text === 'string');
    if (texts.length === 0) throw new LlmError('the answer has no text');
    return texts.map((p) => p.text as string).join('');
  },
};
