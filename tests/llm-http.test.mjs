import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  LLM_MAX_ATTEMPTS, LLM_MAX_RESPONSE_BYTES, LLM_RETRY_WAIT_DEFAULT_MS, LLM_RETRY_WAIT_MAX_MS, LLM_TIMEOUT_MS, LlmError, postJson,
} from '../dist/llm/index.js';
import { FAKE_KEY, fakeFetch, fakeSleep, guardGlobalFetch, hang, hangBody, netError, reply } from './fixtures/llm/fake-fetch.mjs';

/**
 * postJson with an injected fake fetch and sleep: no request leaves the process and no timer waits,
 * except the two timeout cases, which use a 50 ms timeout. Expected values are written by hand.
 */

guardGlobalFetch(after);

const REQUEST = {
  url: 'https://api.example.test/v1/answer',
  headers: { authorization: `Bearer ${FAKE_KEY}`, 'content-type': 'application/json' },
  body: '{"q":1}',
};

async function post(answers, { timeoutMs } = {}) {
  const { fetch, calls } = fakeFetch(...answers);
  const { sleep, waits } = fakeSleep();
  try {
    const json = await postJson(REQUEST, { key: FAKE_KEY, fetch, sleep, timeoutMs });
    return { json, error: null, calls, waits };
  } catch (error) {
    assert.ok(error instanceof LlmError, `expected LlmError, got ${error}`);
    return { json: null, error: error.message, calls, waits };
  }
}

test('http: the limits are the documented chosen values', () => {
  assert.deepEqual(
    [LLM_TIMEOUT_MS, LLM_RETRY_WAIT_MAX_MS, LLM_RETRY_WAIT_DEFAULT_MS, LLM_MAX_RESPONSE_BYTES, LLM_MAX_ATTEMPTS],
    [60_000, 10_000, 2_000, 262_144, 2],
  );
});

test('http: a 200 JSON answer is returned after one POST with the given headers and body, and redirects are refused', async () => {
  const r = await post([reply(200, { ok: true })]);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.calls[0], { url: REQUEST.url, method: 'POST', headers: REQUEST.headers, body: REQUEST.body, redirect: 'error' });
  assert.deepEqual(r.waits, []);
});

test('http: a URL that is not HTTPS is refused before any call', async () => {
  const { fetch, calls } = fakeFetch(reply(200, {}));
  await assert.rejects(postJson({ ...REQUEST, url: 'http://api.example.test/v1' }, { key: FAKE_KEY, fetch, sleep: async () => {} }),
    (e) => e instanceof LlmError && e.message === 'the provider URL is not HTTPS');
  assert.equal(calls.length, 0);
});

test('http: a 500 then a 200 retries once after the default wait', async () => {
  const r = await post([reply(500, { error: { type: 'api_error' } }), reply(200, { ok: 1 })]);
  assert.deepEqual(r.json, { ok: 1 });
  assert.equal(r.calls.length, 2);
  assert.deepEqual(r.waits, [2000]);
});

test('http: a 500 twice fails with the status, the error type and the attempt count', async () => {
  const r = await post([reply(500, { type: 'error', error: { type: 'api_error', message: 'Internal' } })]);
  assert.equal(r.error, 'the provider returned status 500 (api_error) (2 attempts)');
  assert.equal(r.calls.length, 2);
  assert.deepEqual(r.waits, [2000]);
});

for (const status of [408, 429, 503, 529]) {
  test(`http: status ${status} is retried`, async () => {
    const r = await post([reply(status, '')]);
    assert.equal(r.error, `the provider returned status ${status} (2 attempts)`);
    assert.equal(r.calls.length, 2);
  });
}

for (const status of [400, 401, 402, 403, 404]) {
  test(`http: status ${status} is not retried`, async () => {
    const r = await post([reply(status, { error: { status: 'INVALID_ARGUMENT' } })]);
    assert.equal(r.error, `the provider returned status ${status} (INVALID_ARGUMENT)`);
    assert.equal(r.calls.length, 1);
    assert.deepEqual(r.waits, []);
  });
}

test('http: a retry-after within the limit is waited for', async () => {
  const r = await post([reply(429, { error: { type: 'rate_limit_error' } }, { 'retry-after': '7' }), reply(200, { ok: 2 })]);
  assert.deepEqual(r.json, { ok: 2 });
  assert.deepEqual(r.waits, [7000]);
});

test('http: a retry-after over the 10 s limit fails at once', async () => {
  const r = await post([reply(429, { error: { type: 'rate_limit_error' } }, { 'retry-after': '11' })]);
  assert.equal(r.error, 'the provider returned status 429 (rate_limit_error) and asked to wait 11 s, over the 10 s retry limit');
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.waits, []);
});

test('http: a retry-after that is not a number of seconds falls back to the default wait', async () => {
  const r = await post([reply(503, '', { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }), reply(200, {})]);
  assert.deepEqual(r.waits, [2000]);
});

test('http: a network failure is retried and then names only the cause code', async () => {
  const r = await post([netError('ECONNRESET')]);
  assert.equal(r.error, 'the provider could not be reached: ECONNRESET (2 attempts)');
  assert.equal(r.calls.length, 2);
});

test('http: a request that never answers times out on each attempt, the abort signal ends it', async () => {
  const r = await post([hang()], { timeoutMs: 50 });
  assert.equal(r.error, 'the provider did not answer within 50 ms (2 attempts)');
  assert.equal(r.calls.length, 2);
  assert.deepEqual(r.waits, [2000]);
});

test('http: a body that stalls is cut by the same timeout', async () => {
  const r = await post([hangBody()], { timeoutMs: 50 });
  assert.equal(r.error, 'the provider did not answer within 50 ms (2 attempts)');
});

test('http: an answer over 262144 bytes is refused and not retried', async () => {
  const r = await post([reply(200, `"${'x'.repeat(LLM_MAX_RESPONSE_BYTES)}"`)]);
  assert.equal(r.error, 'the answer is over 262144 bytes');
  assert.equal(r.calls.length, 1);
});

test('http: an answer of exactly 262144 bytes is read', async () => {
  const r = await post([reply(200, `"${'x'.repeat(LLM_MAX_RESPONSE_BYTES - 2)}"`)]);
  assert.equal(r.json.length, LLM_MAX_RESPONSE_BYTES - 2);
});

test('http: a 200 answer that is not JSON fails without a retry', async () => {
  const r = await post([reply(200, '<html>oops</html>')]);
  assert.equal(r.error, 'the provider answer is not JSON');
  assert.equal(r.calls.length, 1);
});

test('http: an error type that is long or not a plain word is left out', async () => {
  const r1 = await post([reply(400, { error: { type: 'x'.repeat(65) } })]);
  assert.equal(r1.error, 'the provider returned status 400');
  const r2 = await post([reply(400, { error: { type: 'bad type <b>' } })]);
  assert.equal(r2.error, 'the provider returned status 400');
});

test('http: an error body echoing the fake key never shows it', async () => {
  const body = { error: { type: FAKE_KEY, message: `bad key ${FAKE_KEY}`, code: `x${FAKE_KEY}` } };
  const r = await post([reply(401, body)]);
  assert.ok(!r.error.includes(FAKE_KEY), r.error);
  assert.equal(r.error, 'the provider returned status 401');
  const r2 = await post([netError(FAKE_KEY)]);
  assert.ok(!r2.error.includes(FAKE_KEY), r2.error);
});

test('http: a network error whose message holds the key shows only its name', async () => {
  const fetch = async () => { throw new Error(`header value ${FAKE_KEY} is invalid`); };
  await assert.rejects(postJson(REQUEST, { key: FAKE_KEY, fetch, sleep: async () => {} }), (e) => {
    assert.equal(e.message, 'the provider could not be reached: Error (2 attempts)');
    return true;
  });
});
