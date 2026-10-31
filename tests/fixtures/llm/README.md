# LLM reply fixtures

Provider replies for the LLM ranking tests (tests/llm-adapters.test.mjs, tests/llm-rank.test.mjs and
tests/check.test.mjs). They were written by hand from the shape of each provider's documented example
(read 2026-10-30), not recorded from a real API: no real key was used and no real request was made.

- anthropic*.json: Messages API answers, https://platform.claude.com/docs/en/api/messages
  (content[] text blocks; stop_reason end_turn, refusal and max_tokens).
- openai*.json: Responses API answers, https://developers.openai.com/api/reference/resources/responses/methods/create
  (status completed with output_text, a refusal content item, status incomplete with max_output_tokens).
- gemini*.json: generateContent answers, https://ai.google.dev/api/generate-content
  (candidates[0] with finishReason STOP or MAX_TOKENS, and promptFeedback.blockReason with no candidates).

`example-model` is a labelled placeholder, not a real model name. Ids, timestamps and token counts are
made up. The answer text in anthropic.json, openai.json and gemini.json ranks the one add.diff
suggestion; tests that need another answer replace the text in a copy.
