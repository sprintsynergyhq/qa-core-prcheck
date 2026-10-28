import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  API_VERSION, createGitHubClient, getAllPages, GitHubError, MAX_PAGES, MESSAGE_MAX_CHARS, parseNextLink,
} from '../dist/github/index.js';

/**
 * The GitHub client with an injected fake fetch that records every request. No network. Expected
 * values are written by hand from the GitHub docs (headers, link header) and the rules in api.ts.
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

const clientWith = (respond, apiUrl = API) => {
  const fake = fakeFetch(respond);
  return { client: createGitHubClient({ token: TOKEN, apiUrl, fetch: fake.fn }), calls: fake.calls };
};

function assertNoToken(error) {
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
    assert.equal(error.message, 'GitHub API GET /x failed with status 502');
    assert.equal(error.status, 502);
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
  const client = createGitHubClient({ token: TOKEN, apiUrl: API, fetch: fail });
  await assert.rejects(client.request('GET', '/x'), (error) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.status, null);
    assert.equal(error.message, 'GitHub API GET /x could not be reached: ECONNREFUSED');
    assertNoToken(error);
    return true;
  });
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
