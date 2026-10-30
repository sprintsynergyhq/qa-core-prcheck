// Test helpers for the LLM tests: a fake fetch that answers from a script and records every call, a
// recording sleep, and a guard that makes the real fetch throw. Not a test file: node --test runs
// tests/*.test.mjs only. No request ever leaves the process.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The fake key used in every LLM test. It is not a real key. */
export const FAKE_KEY = 'prcheck_fake_llm_key_for_tests';

/** A reply fixture from this folder, parsed. */
export const replyFixture = (name) => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));

/** A copy of a reply fixture with its answer text replaced. */
export function withText(name, text) {
  const json = replyFixture(name);
  if (name.startsWith('anthropic')) json.content[0].text = text;
  else if (name.startsWith('openai')) json.output[0].content[0].text = text;
  else json.candidates[0].content.parts[0].text = text;
  return json;
}

/** One scripted answer: a JSON or text body with a status and headers. */
export const reply = (status, body, headers = {}) => () => new Response(
  typeof body === 'string' ? body : JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', ...headers } },
);

/**
 * Keeps the event loop alive until the signal aborts, as the open socket of a real request does. The
 * timer of AbortSignal.timeout does not hold the loop open, so on Node 22 a test that only waits for it
 * would be cancelled with "Promise resolution is still pending". Nothing waits on this timer.
 */
function holdUntilAbort(signal) {
  const keepAlive = setInterval(() => {}, 60_000);
  signal.addEventListener('abort', () => clearInterval(keepAlive), { once: true });
}

/** An answer that never comes: it rejects only when the request signal aborts. */
export const hang = () => (url, init) => new Promise((resolve, reject) => {
  holdUntilAbort(init.signal);
  init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
});

/** A 200 answer whose body stream starts and then never ends until the signal aborts. */
export const hangBody = () => (url, init) => new Response(new ReadableStream({
  start(controller) {
    holdUntilAbort(init.signal);
    controller.enqueue(new TextEncoder().encode('{"partial":'));
    init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
  },
}), { status: 200 });

/** A network failure with a cause code, as undici gives. */
export const netError = (code) => () => Promise.reject(new TypeError('fetch failed', { cause: { code } }));

/**
 * A fake fetch that answers with the scripted answers in order (the last one repeats) and records
 * { url, method, headers, body, redirect } for each call.
 */
export function fakeFetch(...answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: { ...init.headers }, body: init.body, redirect: init.redirect });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    return answer(url, init);
  };
  return { fetch, calls };
}

/** A fetch that fails the test when called. */
export function noFetch() {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    throw new Error(`fetch must not be called: ${url}`);
  };
  return { fetch, calls };
}

/** A sleep that records each wait and returns at once. */
export function fakeSleep() {
  const waits = [];
  return { sleep: async (ms) => { waits.push(ms); }, waits };
}

/** Replaces globalThis.fetch with one that throws, so a missed injection can never reach the network. */
export function guardGlobalFetch(after) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('the real fetch must never be called in a test'); };
  after(() => { globalThis.fetch = real; });
}
