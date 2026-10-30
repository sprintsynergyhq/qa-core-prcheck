import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API_VERSION, createGitHubClient, getAllPages, GitHubError, MAX_PAGES, MAX_RETRIES, MAX_RETRY_WAIT_MS, MESSAGE_MAX_CHARS,
  parseNextLink, RATE_LIMIT_WAIT_MS, REQUEST_TIMEOUT_MS, RETRY_BACKOFF_MS,
} from '../dist/github/index.js';

/**
 * The GitHub client with an injected fake fetch that records every request, and an injected sleep that
 * records every wait and returns at once, so no test waits in real time. No network. Expected values
 * are written by hand from the GitHub docs (headers, link header, rate limits) and the rules in api.ts.
 */

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkgVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const TOKEN = 'ghs_fake_token_for_tests';
const API = 'https://api.github.com';

/** A fake fetch: answers come from respond(url, init) in order; every call is recorded. */
function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const answer = await respond(url, init, calls.length);
    return new Response(answer.text ?? JSON.stringify(answer.json ?? null), { status: answer.status ?? 200, headers: answer.headers ?? {} });
  };
  return { fn, calls };
}

// Every error the tests see, for the token scan at the end.
const seenErrors = [];

const clientWith = (respond, apiUrl = API, extra = {}) => {
  const fake = fakeFetch(respond);
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); };
  return { client: createGitHubClient({ token: TOKEN, apiUrl, fetch: fake.fn, sleep, ...extra }), calls: fake.calls, waits };
};

function assertNoToken(error) {
  seenErrors.push(error);
  assert.ok(!String(error.message).includes(TOKEN), error.message);
  assert.ok(!String(error.stack).includes(TOKEN), 'token in the stack');
}

test('API_VERSION, MESSAGE_MAX_CHARS and MAX_PAGES', () => {
  assert.deepEqual([API_VERSION, MESSAGE_MAX_CHARS, MAX_PAGES], ['2026-03-10', 200, 50]);
});

test('a GET sends exactly the documented headers and no body', async () => {
  const { client, calls } = clientWith(() => ({ json: [] }));
  await client.request('GET', '/repos/demo-owner/demo-shop/issues/7/comments?per_page=100');
  assert.deepEqual(calls, [{
    url: 'https://api.github.com/repos/demo-owner/demo-shop/issues/7/comments?per_page=100',
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': `qa-core-prcheck/${pkgVersion}`,
    },
    body: undefined,
  }]);
});

test('a POST adds Content-Type and sends the body as JSON', async () => {
  const { client, calls } = clientWith(() => ({ status: 201, json: { id: 101 } }));
  await client.request('POST', '/repos/demo-owner/demo-shop/issues/7/comments', { body: 'hello' });
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.equal(calls[0].body, '{"body":"hello"}');
});

test('a 2xx answer returns the status, the JSON and the link header', async () => {
  const link = '<https://api.github.com/repositories/1300192/issues?page=4>; rel="next"';
  const { client } = clientWith(() => ({ json: [{ id: 1 }], headers: { link } }));
  assert.deepEqual(await client.request('GET', '/x'), { status: 200, json: [{ id: 1 }], link });
  const empty = clientWith(() => ({ text: '' }));
  assert.deepEqual(await empty.client.request('GET', '/x'), { status: 200, json: null, link: null });
});

const FAILURES = [
  [403, 'POST', '/repos/demo-owner/demo-shop/issues/7/comments', 'Resource not accessible by integration'],
  [404, 'GET', '/repos/demo-owner/demo-shop/issues/7/comments?per_page=100', 'Not Found'],
  [422, 'PATCH', '/repos/demo-owner/demo-shop/issues/comments/55', 'Validation Failed'],
];

for (const [status, method, target, message] of FAILURES) {
  test(`a ${status} throws GitHubError with the method, the path without its query, the status and the message`, async () => {
    const { client } = clientWith(() => ({ status, json: { message, documentation_url: 'https://docs.github.com/rest' } }));
    await assert.rejects(client.request(method, target, method === 'GET' ? undefined : { body: 'x' }), (error) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.status, status);
      assert.equal(error.message, `GitHub API ${method} ${target.split('?')[0]} failed with status ${status}: ${message}`);
      assertNoToken(error);
      return true;
    });
  });
}

test('a failure without a JSON message names only the status', async () => {
  const { client } = clientWith(() => ({ status: 502, text: '<html>Bad gateway</html>' }));
  await assert.rejects(client.request('GET', '/x'), (error) => {
    // A GET on 502 is retried, so the message ends with the number of attempts.
    assert.equal(error.message, 'GitHub API GET /x failed with status 502 (3 attempts)');
    assert.equal(error.status, 502);
    assertNoToken(error);
    return true;
  });
});

test('a long API message is cut at MESSAGE_MAX_CHARS, kept on one line, and a token in it is replaced', async () => {
  const { client } = clientWith(() => ({ status: 422, json: { message: `bad\n${TOKEN} ${'x'.repeat(400)}` } }));
  await assert.rejects(client.request('GET', '/x'), (error) => {
    const expectedMessage = `bad *** ${'x'.repeat(400)}`.slice(0, 200);
    assert.equal(error.message, `GitHub API GET /x failed with status 422: ${expectedMessage}...`);
    assertNoToken(error);
    return true;
  });
});

test('a 2xx body that is not JSON throws GitHubError', async () => {
  const { client } = clientWith(() => ({ text: 'not json' }));
  await assert.rejects(client.request('GET', '/x'), (error) => {
    assert.equal(error.message, 'GitHub API GET /x returned a body that is not JSON');
    return true;
  });
});

test('a fetch that cannot connect gives status null and the error code only', async () => {
  const fail = async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error(`connect to ${TOKEN}`), { code: 'ECONNREFUSED' }) }); };
  const waits = [];
  const client = createGitHubClient({ token: TOKEN, apiUrl: API, fetch: fail, sleep: async (ms) => { waits.push(ms); } });
  await assert.rejects(client.request('GET', '/x'), (error) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.status, null);
    // A network error on a GET is retried, so the message ends with the number of attempts.
    assert.equal(error.message, 'GitHub API GET /x could not be reached: ECONNREFUSED (3 attempts)');
    assertNoToken(error);
    return true;
  });
  assert.deepEqual(waits, [2000, 4000]);
});

test('a full URL on another origin is refused before any request', async () => {
  const { client, calls } = clientWith(() => ({ json: [] }));
  await assert.rejects(client.request('GET', 'https://example.com/repos/x'), (error) => {
    assert.equal(error.message, 'Refusing a GET request outside the GitHub API URL');
    return true;
  });
  assert.deepEqual(calls, []);
});

const API_URLS = [
  ['https://api.github.com', null],
  ['https://ghes.example.com/api/v3', null],
  ['http://127.0.0.1:8080', null],
  ['http://[::1]:8080', null],
  ['http://localhost:8080', null],
  ['http://api.github.com', 'GITHUB_API_URL must use https (plain http only for 127.0.0.1, ::1 or localhost)'],
  ['ftp://api.github.com', 'GITHUB_API_URL must use https (plain http only for 127.0.0.1, ::1 or localhost)'],
  ['https://user:secret@api.github.com', 'GITHUB_API_URL must not hold a user name or password'],
  ['not a url', 'GITHUB_API_URL is not a valid URL'],
];

for (const [apiUrl, message] of API_URLS) {
  test(`API URL ${apiUrl}: ${message ?? 'accepted'}`, () => {
    const make = () => createGitHubClient({ token: TOKEN, apiUrl, fetch: async () => { throw new Error('no request expected'); } });
    if (message === null) {
      assert.doesNotThrow(make);
    } else {
      assert.throws(make, (error) => {
        assert.ok(error instanceof GitHubError);
        assert.equal(error.message, message);
        assertNoToken(error);
        return true;
      });
    }
  });
}

test('an empty token is refused before any request', () => {
  assert.throws(() => createGitHubClient({ token: '', apiUrl: API, fetch }), (error) => {
    assert.equal(error.message, 'GITHUB_TOKEN is not set');
    return true;
  });
});

test('a path is joined to an API URL with a path, such as GitHub Enterprise Server', async () => {
  const { client, calls } = clientWith(() => ({ json: [] }), 'https://ghes.example.com/api/v3');
  await client.request('GET', '/repos/a/b/issues/1/comments');
  assert.equal(calls[0].url, 'https://ghes.example.com/api/v3/repos/a/b/issues/1/comments');
});

// The example link header from https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api
const DOCS_LINK = '<https://api.github.com/repositories/1300192/issues?page=2>; rel="prev", '
  + '<https://api.github.com/repositories/1300192/issues?page=4>; rel="next", '
  + '<https://api.github.com/repositories/1300192/issues?page=515>; rel="last", '
  + '<https://api.github.com/repositories/1300192/issues?page=1>; rel="first"';

test('parseNextLink reads rel="next" from the docs example', () => {
  assert.equal(parseNextLink(DOCS_LINK, API), 'https://api.github.com/repositories/1300192/issues?page=4');
});

test('parseNextLink gives null without a next link or without a header', () => {
  const lastPage = '<https://api.github.com/repositories/1300192/issues?page=514>; rel="prev", <https://api.github.com/repositories/1300192/issues?page=1>; rel="first"';
  assert.equal(parseNextLink(lastPage, API), null);
  assert.equal(parseNextLink(null, API), null);
  assert.equal(parseNextLink('', API), null);
});

test('parseNextLink gives null for a next link on another origin', () => {
  assert.equal(parseNextLink('<https://example.com/repositories/1300192/issues?page=4>; rel="next"', API), null);
  assert.equal(parseNextLink('<http://api.github.com/repositories/1300192/issues?page=4>; rel="next"', API), null);
});

test('getAllPages follows next links and joins the items', async () => {
  const { client, calls } = clientWith((url) => {
    const page = Number(new URL(url).searchParams.get('page') ?? '1');
    const link = page < 3 ? `<${API}/repos/a/b/issues/1/comments?per_page=100&page=${page + 1}>; rel="next"` : undefined;
    return { json: [{ id: page }], headers: link ? { link } : {} };
  });
  assert.deepEqual(await getAllPages(client, '/repos/a/b/issues/1/comments?per_page=100'), [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(calls.length, 3);
});

test('getAllPages stops after MAX_PAGES pages with a GitHubError', async () => {
  const { client, calls } = clientWith((url, init, n) => ({
    json: [{ id: n }],
    headers: { link: `<${API}/repos/a/b/issues/1/comments?per_page=100&page=${n + 1}>; rel="next"` },
  }));
  await assert.rejects(getAllPages(client, '/repos/a/b/issues/1/comments?per_page=100'), (error) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.message, 'GitHub API GET /repos/a/b/issues/1/comments has more than 50 pages');
    return true;
  });
  assert.equal(calls.length, 50);
});

test('getAllPages refuses an answer that is not a list', async () => {
  const { client } = clientWith(() => ({ json: { message: 'not a list' } }));
  await assert.rejects(getAllPages(client, '/repos/a/b/issues/1/comments?per_page=100'), (error) => {
    assert.equal(error.message, 'GitHub API GET /repos/a/b/issues/1/comments did not return a list');
    return true;
  });
});

// Retries, waits and timeouts (S2). Every wait goes through the injected sleep.

test('REQUEST_TIMEOUT_MS, MAX_RETRIES, RETRY_BACKOFF_MS, MAX_RETRY_WAIT_MS and RATE_LIMIT_WAIT_MS', () => {
  assert.deepEqual([REQUEST_TIMEOUT_MS, MAX_RETRIES, RETRY_BACKOFF_MS, MAX_RETRY_WAIT_MS, RATE_LIMIT_WAIT_MS], [30000, 2, 2000, 60000, 60000]);
});

/** Answers from a list, one per request, then the last one again. */
const inTurn = (...answers) => (url, init, n) => answers[Math.min(n, answers.length) - 1];

test('GET 502 then 200 succeeds after one wait of RETRY_BACKOFF_MS', async () => {
  const { client, calls, waits } = clientWith(inTurn({ status: 502, text: 'Bad gateway' }, { json: [{ id: 1 }] }));
  assert.deepEqual(await client.request('GET', '/x'), { status: 200, json: [{ id: 1 }], link: null });
  assert.equal(calls.length, 2);
  assert.deepEqual(waits, [2000]);
});

test('PATCH 503 then 200 is retried too', async () => {
  const { client, calls, waits } = clientWith(inTurn({ status: 503, json: { message: 'Service Unavailable' } }, { json: { id: 55 } }));
  assert.equal((await client.request('PATCH', '/repos/demo-owner/demo-shop/issues/comments/55', { body: 'x' })).status, 200);
  assert.deepEqual([calls.length, waits], [2, [2000]]);
});

test('three 503s on a GET throw with the attempt count after waits of 2000 and 4000 ms', async () => {
  const { client, calls, waits } = clientWith(() => ({ status: 503, json: { message: 'Service Unavailable' } }));
  await assert.rejects(client.request('GET', '/repos/demo-owner/demo-shop/issues/7/comments?per_page=100'), (error) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.message, 'GitHub API GET /repos/demo-owner/demo-shop/issues/7/comments failed with status 503: Service Unavailable (3 attempts)');
    assert.deepEqual([error.status, error.method, error.retryable, error.rateLimited], [503, 'GET', true, false]);
    assertNoToken(error);
    return true;
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [2000, 4000]);
});

test('429 with retry-after: 5 waits 5000 ms', async () => {
  const { client, calls, waits } = clientWith(inTurn({ status: 429, json: { message: 'Too Many Requests' }, headers: { 'retry-after': '5' } }, { json: [] }));
  await client.request('GET', '/x');
  assert.deepEqual([calls.length, waits], [2, [5000]]);
});

test('429 with no retry-after and no x-ratelimit-reset waits RATE_LIMIT_WAIT_MS, exactly 60000 ms, which the limit allows', async () => {
  const { client, calls, waits } = clientWith(inTurn({ status: 429, json: { message: 'Too Many Requests' } }, { json: [] }));
  await client.request('GET', '/x');
  assert.deepEqual([calls.length, waits], [2, [60000]]);
});

test('403 with x-ratelimit-remaining: 0 and a reset 10 s ahead waits 10000 ms, and is rateLimited when it still fails', async () => {
  const now = 1_700_000_000_000;
  const headers = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 10) };
  const { client, calls, waits } = clientWith(() => ({ status: 403, json: { message: 'API rate limit exceeded' }, headers }), API, { now: () => now });
  await assert.rejects(client.request('GET', '/x'), (error) => {
    assert.equal(error.message, 'GitHub API GET /x failed with status 403: API rate limit exceeded (3 attempts)');
    assert.deepEqual([error.status, error.rateLimited, error.retryable, error.waitMs], [403, true, true, 10000]);
    assertNoToken(error);
    return true;
  });
  assert.deepEqual([calls.length, waits], [3, [10000, 10000]]);
});

test('a 403 with retry-after: 0 is rate limited and retried at once', async () => {
  const { client, calls, waits } = clientWith(inTurn({ status: 403, json: { message: 'You have exceeded a secondary rate limit' }, headers: { 'retry-after': '0' } }, { json: [] }));
  await client.request('GET', '/x');
  assert.deepEqual([calls.length, waits], [2, [0]]);
});

test('a reset already in the past waits 0 ms', async () => {
  const now = 1_700_000_000_000;
  const headers = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 - 5) };
  const { client, waits } = clientWith(inTurn({ status: 429, headers }, { json: [] }), API, { now: () => now });
  await client.request('GET', '/x');
  assert.deepEqual(waits, [0]);
});

test('a wait above MAX_RETRY_WAIT_MS fails at once, with the seconds GitHub asked for', async () => {
  const now = 1_700_000_000_000;
  const cases = [
    [{ 'retry-after': '61' }, 'GitHub API GET /x failed with status 429: Too Many Requests. GitHub asked to wait 61 s, longer than the 60 s retry limit'],
    [{ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 120) },
      'GitHub API GET /x failed with status 429: Too Many Requests. GitHub asked to wait 120 s, longer than the 60 s retry limit'],
  ];
  for (const [headers, message] of cases) {
    const { client, calls, waits } = clientWith(() => ({ status: 429, json: { message: 'Too Many Requests' }, headers }), API, { now: () => now });
    await assert.rejects(client.request('GET', '/x'), (error) => {
      assert.equal(error.message, message);
      assert.deepEqual([error.status, error.rateLimited, error.retryable], [429, true, false]);
      assertNoToken(error);
      return true;
    });
    assert.deepEqual([calls.length, waits], [1, []]);
  }
});

for (const [status, method, message] of [[403, 'GET', 'Resource not accessible by integration'], [404, 'GET', 'Not Found'], [422, 'PATCH', 'Validation Failed']]) {
  test(`a plain ${status} on a ${method} sends one request and is not rate limited`, async () => {
    const { client, calls, waits } = clientWith(() => ({ status, json: { message } }));
    await assert.rejects(client.request(method, '/x', method === 'GET' ? undefined : { body: 'x' }), (error) => {
      assert.deepEqual([error.status, error.method, error.rateLimited, error.retryable], [status, method, false, false]);
      assertNoToken(error);
      return true;
    });
    assert.deepEqual([calls.length, waits], [1, []]);
  });
}

test('POST is never retried by the client: a POST on 502 sends one request', async () => {
  const { client, calls, waits } = clientWith(() => ({ status: 502, text: 'Bad gateway' }));
  await assert.rejects(client.request('POST', '/repos/demo-owner/demo-shop/issues/7/comments', { body: 'x' }), (error) => {
    assert.equal(error.message, 'GitHub API POST /repos/demo-owner/demo-shop/issues/7/comments failed with status 502');
    assert.deepEqual([error.status, error.method, error.retryable], [502, 'POST', true]);
    assertNoToken(error);
    return true;
  });
  assert.deepEqual([calls.length, waits], [1, []]);
});

// The injected timeout for the hanging fetch. A chosen value, long enough for the request to start.
const SHORT_TIMEOUT_MS = 50;
/**
 * A fetch that never answers: it rejects only when its signal aborts, with the signal's reason. A real
 * fetch keeps the process alive with its open socket, while the timer of AbortSignal.timeout does not,
 * so this fake holds an interval until the abort for the same purpose. The interval waits for nothing.
 */
const hangingFetch = (calls) => (url, init) => {
  calls.push(init.method);
  const keepAlive = setInterval(() => {}, 1_000);
  return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => {
    clearInterval(keepAlive);
    reject(init.signal.reason);
  }));
};

test('a fetch that answers only when its signal aborts gives the timeout message; a GET tries 3 times, a POST once', async () => {
  for (const [method, attempts, message, expectedWaits] of [
    ['POST', 1, `GitHub API POST /x timed out after ${SHORT_TIMEOUT_MS} ms`, []],
    ['GET', 3, `GitHub API GET /x timed out after ${SHORT_TIMEOUT_MS} ms (3 attempts)`, [2000, 4000]],
  ]) {
    const calls = [];
    const waits = [];
    const client = createGitHubClient({
      token: TOKEN, apiUrl: API, fetch: hangingFetch(calls), sleep: async (ms) => { waits.push(ms); }, timeoutMs: SHORT_TIMEOUT_MS,
    });
    await assert.rejects(client.request(method, '/x', method === 'POST' ? { body: 'x' } : undefined), (error) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.message, message);
      assert.deepEqual([error.status, error.retryable], [null, true]);
      assertNoToken(error);
      return true;
    });
    assert.deepEqual([calls.length, waits], [attempts, expectedWaits]);
  }
});

test('without timeoutMs, every request still carries an abort signal, which has not fired when the answer comes', async () => {
  const signals = [];
  const fetchFn = async (url, init) => { signals.push(init.signal); return new Response('[]'); };
  const client = createGitHubClient({ token: TOKEN, apiUrl: API, fetch: fetchFn });
  await client.request('GET', '/x');
  await client.request('GET', '/y');
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal instanceof AbortSignal && !signal.aborted));
  assert.notEqual(signals[0], signals[1], 'one signal per request');
});

test('an answer whose body breaks off is a retryable error with the status, sent once for a POST', async () => {
  const calls = [];
  const broken = async (url, init) => {
    calls.push(init.method);
    return new Response(new ReadableStream({ start(controller) { controller.error(new Error(`reset by ${TOKEN}`)); } }), { status: 201 });
  };
  const client = createGitHubClient({ token: TOKEN, apiUrl: API, fetch: broken, sleep: async () => {} });
  await assert.rejects(client.request('POST', '/x', { body: 'x' }), (error) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.message, 'GitHub API POST /x broke off its answer: Error');
    assert.deepEqual([error.status, error.method, error.retryable], [201, 'POST', true]);
    assertNoToken(error);
    return true;
  });
  assert.deepEqual(calls, ['POST']);
});

// A secondary rate limit 403 with no rate limit header (PR 7a). The docs give no exact message text;
// these messages are made up to hold the words rate limit.
const SECONDARY = { status: 403, json: { message: 'You have exceeded a secondary rate limit' } };

test('a secondary rate limit 403 with no headers on a GET is rate limited: 3 requests, waits of 60000 and 60000 ms', async () => {
  const { client, calls, waits } = clientWith(() => SECONDARY);
  await assert.rejects(client.request('GET', '/x'), (error) => {
    assert.equal(error.message, 'GitHub API GET /x failed with status 403: You have exceeded a secondary rate limit (3 attempts)');
    assert.deepEqual([error.status, error.method, error.rateLimited, error.retryable, error.waitMs], [403, 'GET', true, true, null]);
    assertNoToken(error);
    return true;
  });
  assert.deepEqual([calls.length, waits], [3, [60000, 60000]]);
});

test('a secondary rate limit 403 with no headers, then 200, succeeds after one wait of 60000 ms', async () => {
  const { client, calls, waits } = clientWith(inTurn(SECONDARY, { json: [{ id: 1 }] }));
  assert.deepEqual(await client.request('GET', '/x'), { status: 200, json: [{ id: 1 }], link: null });
  assert.deepEqual([calls.length, waits], [2, [60000]]);
});

test('a secondary rate limit 403 with no headers on a PATCH is retried the same way', async () => {
  const { client, calls, waits } = clientWith(() => SECONDARY);
  await assert.rejects(client.request('PATCH', '/repos/demo-owner/demo-shop/issues/comments/9', { body: 'x' }), (error) => {
    assert.equal(error.message, 'GitHub API PATCH /repos/demo-owner/demo-shop/issues/comments/9 failed with status 403: You have exceeded a secondary rate limit (3 attempts)');
    assert.deepEqual([error.status, error.method, error.rateLimited, error.retryable], [403, 'PATCH', true, true]);
    assertNoToken(error);
    return true;
  });
  assert.deepEqual([calls.length, waits], [3, [60000, 60000]]);
});

test('a secondary rate limit 403 with no headers on a POST sends one request and throws rateLimited', async () => {
  const { client, calls, waits } = clientWith(() => SECONDARY);
  await assert.rejects(client.request('POST', '/repos/demo-owner/demo-shop/issues/7/comments', { body: 'x' }), (error) => {
    assert.equal(error.message, 'GitHub API POST /repos/demo-owner/demo-shop/issues/7/comments failed with status 403: You have exceeded a secondary rate limit');
    assert.deepEqual([error.status, error.method, error.rateLimited, error.retryable], [403, 'POST', true, true]);
    assertNoToken(error);
    return true;
  });
  assert.deepEqual([calls.length, waits], [1, []]);
});

for (const message of ['Secondary Rate Limit hit', 'API RATE LIMIT EXCEEDED for installation', 'API rate limit exceeded']) {
  test(`a 403 with no headers and the message "${message}" is rate limited (any case; the primary message matches too)`, async () => {
    const { client, calls, waits } = clientWith(inTurn({ status: 403, json: { message } }, { json: [] }));
    await client.request('GET', '/x');
    assert.deepEqual([calls.length, waits], [2, [60000]]);
  });
}

for (const [name, answer] of [
  ['a plain 403 message', { status: 403, json: { message: 'Resource not accessible by integration' } }],
  ['a 403 body that is not JSON, even if it says rate limit', { status: 403, text: 'rate limit' }],
  ['a 403 JSON body without a message', { status: 403, json: { error: 'rate limit' } }],
  ['a 403 JSON message that is not a string', { status: 403, json: { message: ['rate limit'] } }],
  ['a 403 with an empty body', { status: 403, text: '' }],
]) {
  test(`${name} with no headers is not rate limited: one request on a GET`, async () => {
    const { client, calls, waits } = clientWith(() => answer);
    await assert.rejects(client.request('GET', '/x'), (error) => {
      assert.deepEqual([error.status, error.rateLimited, error.retryable], [403, false, false]);
      assertNoToken(error);
      return true;
    });
    assert.deepEqual([calls.length, waits], [1, []]);
  });
}

test('a 404 or 422 whose message says rate limit stays a plain error: only a 403 reads the message', async () => {
  for (const [status, method] of [[404, 'GET'], [422, 'PATCH']]) {
    const { client, calls } = clientWith(() => ({ status, json: { message: 'rate limit' } }));
    await assert.rejects(client.request(method, '/x', method === 'GET' ? undefined : { body: 'x' }), (error) => {
      assert.deepEqual([error.status, error.rateLimited, error.retryable], [status, false, false]);
      assertNoToken(error);
      return true;
    });
    assert.equal(calls.length, 1);
  }
});

test('a secondary rate limit 403 whose message repeats the token keeps it out of the error', async () => {
  const { client } = clientWith(() => ({ status: 403, json: { message: `You have exceeded a secondary rate limit for ${TOKEN}` } }));
  await assert.rejects(client.request('POST', '/x', { body: 'x' }), (error) => {
    assert.equal(error.message, 'GitHub API POST /x failed with status 403: You have exceeded a secondary rate limit for ***');
    assert.equal(error.rateLimited, true);
    assertNoToken(error);
    return true;
  });
});

// Runs last: node:test runs the tests of a file in order.
test('token scan: no message or stack of any error above holds the token', (t) => {
  assert.ok(seenErrors.length >= 20, `${seenErrors.length} errors`);
  const hits = seenErrors.filter((error) => `${error.message}\n${error.stack}`.includes(TOKEN));
  t.diagnostic(`scanned ${seenErrors.length} errors (message and stack) for ${TOKEN}: ${hits.length} hits`);
  assert.deepEqual(hits, []);
});
