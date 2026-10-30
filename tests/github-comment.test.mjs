import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_LOGIN, BOT_TYPE, confirmCommentAuthor, createGitHubClient, DEFAULT_COMMENT_AUTHOR, findStickyComment, GitHubError,
  parseCommentAuthor, upsertStickyComment,
} from '../dist/github/index.js';
import { MAX_SUMMARY_BYTES, SUMMARY_MARKER } from '../dist/report/index.js';

/**
 * The sticky comment logic with a fake GitHub API behind an injected fetch. The fake serves the issue
 * comments of one pull request in pages and records every request; every wait goes through an injected
 * sleep that records it and returns at once. No network.
 */

const TOKEN = 'ghs_fake_token_for_tests';
const API = 'https://api.github.com';
const LIST = '/repos/demo-owner/demo-shop/issues/7/comments';
const BODY = `${SUMMARY_MARKER}\n## PR Check: Passed\n`;
const OLD_BODY = `${SUMMARY_MARKER}\n## PR Check: Failed\n`;

const GITHUB_ACTIONS_BOT = { login: 'github-actions[bot]', type: 'Bot' };
const byUser = (id, body, user) => ({ id, body, html_url: `https://github.com/demo-owner/demo-shop/pull/7#issuecomment-${id}`, user });
const bot = (id, body) => byUser(id, body, GITHUB_ACTIONS_BOT);
const person = (id, body) => byUser(id, body, { login: 'demo-reviewer', type: 'User' });

/**
 * A fake API holding pages of comments. POST answers id 900; PATCH echoes the id from the path. Both
 * answer as written by options.writer (default github-actions[bot]). GET /user answers options.user, or
 * 404 without it. options.fail holds answers used first, one per request, for a method, for example
 * { POST: [{ status: 502 }] }; an answer's then() runs before it is sent.
 */
function fakeApi(pages, options = {}) {
  const requests = [];
  const waits = [];
  const fail = Object.fromEntries(Object.entries(options.fail ?? {}).map(([method, answers]) => [method, [...answers]]));
  const writer = options.writer ?? GITHUB_ACTIONS_BOT;
  const fetchFn = async (url, init) => {
    const u = new URL(url);
    requests.push({ method: init.method, path: `${u.pathname}${u.search}`, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const queued = fail[init.method]?.shift();
    if (queued !== undefined) {
      queued.then?.();
      return new Response(JSON.stringify({ message: queued.message ?? 'Server Error' }), { status: queued.status, headers: queued.headers ?? {} });
    }
    if (init.method === 'GET' && u.pathname === '/user' && options.user !== undefined) {
      return new Response(JSON.stringify(options.user), { status: 200 });
    }
    if (init.method === 'GET' && u.pathname === LIST) {
      const page = Number(u.searchParams.get('page') ?? '1');
      const headers = page < pages.length ? { link: `<${API}${LIST}?per_page=100&page=${page + 1}>; rel="next"` } : {};
      return new Response(JSON.stringify(pages[page - 1] ?? []), { status: 200, headers });
    }
    if (init.method === 'POST' && u.pathname === LIST) {
      return new Response(JSON.stringify(byUser(900, JSON.parse(init.body).body, writer)), { status: 201 });
    }
    const patched = u.pathname.match(/^\/repos\/demo-owner\/demo-shop\/issues\/comments\/(\d+)$/);
    if (init.method === 'PATCH' && patched) {
      return new Response(JSON.stringify(byUser(Number(patched[1]), JSON.parse(init.body).body, writer)), { status: 200 });
    }
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  };
  const sleep = async (ms) => { waits.push(ms); };
  return { client: createGitHubClient({ token: TOKEN, apiUrl: API, fetch: fetchFn, sleep }), requests, waits };
}

const upsert = (client, body = BODY, author = DEFAULT_COMMENT_AUTHOR) => upsertStickyComment({ client, owner: 'demo-owner', repo: 'demo-shop', number: 7, body, author });
const GET = (page) => ({ method: 'GET', path: page === 1 ? `${LIST}?per_page=100` : `${LIST}?per_page=100&page=${page}`, body: undefined });

test('the bot is github-actions[bot] of type Bot', () => {
  assert.deepEqual([BOT_LOGIN, BOT_TYPE], ['github-actions[bot]', 'Bot']);
});

test('no comments: one GET, then one POST with the body', async () => {
  const { client, requests } = fakeApi([[]]);
  assert.deepEqual(await upsert(client), {
    action: 'created', id: 900, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-900', duplicates: 0, author: 'github-actions[bot]',
  });
  assert.deepEqual(requests, [GET(1), { method: 'POST', path: LIST, body: { body: BODY } }]);
});

test('a bot comment with the marker: one PATCH to its id, no POST', async () => {
  const { client, requests } = fakeApi([[person(10, 'Looks good'), bot(55, OLD_BODY)]]);
  assert.deepEqual(await upsert(client), {
    action: 'updated', id: 55, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-55', duplicates: 0, author: 'github-actions[bot]',
  });
  assert.deepEqual(requests, [GET(1), { method: 'PATCH', path: '/repos/demo-owner/demo-shop/issues/comments/55', body: { body: BODY } }]);
});

test('a user comment that starts with the marker is never edited: a new comment is posted', async () => {
  const { client, requests } = fakeApi([[person(20, OLD_BODY)]]);
  const result = await upsert(client);
  assert.equal(result.action, 'created');
  assert.deepEqual(requests.map((r) => r.method), ['GET', 'POST']);
});

test('a comment by a Bot with another login, or by a User named github-actions[bot], is never edited', async () => {
  const otherBot = { ...bot(30, OLD_BODY), user: { login: 'demo-helper[bot]', type: 'Bot' } };
  const userNamedLikeBot = { ...bot(31, OLD_BODY), user: { login: 'github-actions[bot]', type: 'User' } };
  const { client, requests } = fakeApi([[otherBot, userNamedLikeBot]]);
  assert.equal((await upsert(client)).action, 'created');
  assert.deepEqual(requests.map((r) => r.method), ['GET', 'POST']);
});

test('a bot comment without the marker at the start is ignored', async () => {
  const { client, requests } = fakeApi([[bot(40, 'Deploy preview ready'), bot(41, `Note\n${SUMMARY_MARKER}`)]]);
  assert.equal((await upsert(client)).action, 'created');
  assert.deepEqual(requests.map((r) => r.method), ['GET', 'POST']);
});

test('the match on page 3 of 3 is found: three GETs, one PATCH, no POST', async () => {
  const filler = (from) => Array.from({ length: 100 }, (_, i) => person(from + i, 'A comment'));
  const { client, requests } = fakeApi([filler(1000), filler(2000), [person(3000, 'Last one'), bot(3001, OLD_BODY)]]);
  assert.deepEqual(await upsert(client), {
    action: 'updated', id: 3001, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-3001', duplicates: 0, author: 'github-actions[bot]',
  });
  assert.deepEqual(requests, [
    GET(1), GET(2), GET(3),
    { method: 'PATCH', path: '/repos/demo-owner/demo-shop/issues/comments/3001', body: { body: BODY } },
  ]);
});

test('two matches: the oldest (lowest id) is updated and the other is counted as a duplicate', async () => {
  const { client, requests } = fakeApi([[bot(77, OLD_BODY), bot(60, OLD_BODY)]]);
  assert.deepEqual(await upsert(client), {
    action: 'updated', id: 60, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-60', duplicates: 1, author: 'github-actions[bot]',
  });
  assert.equal(requests.at(-1).path, '/repos/demo-owner/demo-shop/issues/comments/60');
});

test('findStickyComment is pure and skips items that are not comments', () => {
  const comments = [null, 'text', { id: 'x' }, person(1, BODY), bot(9, BODY), bot(3, BODY)];
  const copy = structuredClone(comments);
  assert.deepEqual(findStickyComment(comments, SUMMARY_MARKER, DEFAULT_COMMENT_AUTHOR), { comment: bot(3, BODY), duplicates: 1 });
  assert.deepEqual(comments, copy);
  assert.equal(findStickyComment([], SUMMARY_MARKER, DEFAULT_COMMENT_AUTHOR), null);
});

test('a body that does not start with the marker is refused with no request', async () => {
  const { client, requests } = fakeApi([[]]);
  await assert.rejects(upsert(client, `## PR Check: Passed\n${SUMMARY_MARKER}\n`), (error) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.message, 'The summary does not start with the qa-core-prcheck marker');
    return true;
  });
  assert.deepEqual(requests, []);
});

test('a body over MAX_SUMMARY_BYTES in UTF-8 bytes is refused with no request, even with fewer characters', async () => {
  // Each smile is 2 UTF-16 units and 4 UTF-8 bytes, so this body has fewer characters than the byte cap.
  const smile = String.fromCodePoint(0x1f600);
  const body = `${SUMMARY_MARKER}\n${smile.repeat(15000)}`;
  const bytes = Buffer.byteLength(body, 'utf8');
  assert.ok(body.length < MAX_SUMMARY_BYTES && bytes > MAX_SUMMARY_BYTES, `${body.length} units, ${bytes} bytes`);
  const { client, requests } = fakeApi([[]]);
  await assert.rejects(upsert(client, body), (error) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.message, `The summary has ${bytes} bytes, more than the cap of 60000`);
    return true;
  });
  assert.deepEqual(requests, []);
});

test('a body of exactly MAX_SUMMARY_BYTES is sent', async () => {
  const body = `${SUMMARY_MARKER}\n`.padEnd(MAX_SUMMARY_BYTES, 'x');
  const { client, requests } = fakeApi([[]]);
  assert.equal((await upsert(client, body)).action, 'created');
  assert.equal(requests.at(-1).body.body.length, 60000);
});

// The configured author (S1).

const APP_BOT = { login: 'my-app[bot]', type: 'Bot' };
const PATCH = (id) => ({ method: 'PATCH', path: `/repos/demo-owner/demo-shop/issues/comments/${id}`, body: { body: BODY } });
const POST = { method: 'POST', path: LIST, body: { body: BODY } };
const GET_USER = { method: 'GET', path: '/user', body: undefined };

test('DEFAULT_COMMENT_AUTHOR is github-actions[bot] of type Bot', () => {
  assert.deepEqual(DEFAULT_COMMENT_AUTHOR, { login: 'github-actions[bot]', type: 'Bot' });
});

test('parseCommentAuthor: empty or unset gives the default, [bot] gives a Bot, another login a User, anything else null', () => {
  const cases = [
    [undefined, DEFAULT_COMMENT_AUTHOR],
    ['', DEFAULT_COMMENT_AUTHOR],
    ['github-actions[bot]', DEFAULT_COMMENT_AUTHOR],
    ['my-app[bot]', APP_BOT],
    ['demo-reviewer', { login: 'demo-reviewer', type: 'User' }],
    ['Demo-Reviewer2', { login: 'Demo-Reviewer2', type: 'User' }],
    ['a', { login: 'a', type: 'User' }],
  ];
  for (const [value, author] of cases) assert.deepEqual(parseCommentAuthor(value), author, String(value));
  const invalid = [
    'bad name', '-demo', 'demo-', 'demo--reviewer', 'demo_reviewer', 'octocat_acme', '[bot]', 'my-app[bot] ', ' my-app[bot]',
    'my-app[bot][bot]', 'my-app[Bot]', 'demo\nreviewer', `d${String.fromCodePoint(0xe9)}mo`, '@demo-reviewer', 'demo.reviewer',
  ];
  for (const value of invalid) assert.equal(parseCommentAuthor(value), null, JSON.stringify(value));
});

test('my-app[bot] updates its own comment and ignores a github-actions[bot] one, with no GET /user', async () => {
  const { client, requests } = fakeApi([[bot(55, OLD_BODY), byUser(60, OLD_BODY, APP_BOT)]], { writer: APP_BOT });
  assert.deepEqual(await confirmCommentAuthor(client, APP_BOT), APP_BOT);
  assert.deepEqual(await upsert(client, BODY, APP_BOT), {
    action: 'updated', id: 60, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-60', duplicates: 0, author: 'my-app[bot]',
  });
  assert.deepEqual(requests, [GET(1), PATCH(60)]);
});

test('the default author ignores a my-app[bot] comment with the marker', async () => {
  const { client, requests } = fakeApi([[byUser(60, OLD_BODY, APP_BOT)]]);
  assert.equal((await upsert(client)).action, 'created');
  assert.deepEqual(requests, [GET(1), POST]);
});

test('a User comment with the marker never matches a bot author, even with the same login', async () => {
  const { client, requests } = fakeApi([[byUser(20, OLD_BODY, { login: 'my-app[bot]', type: 'User' })]], { writer: APP_BOT });
  assert.equal((await upsert(client, BODY, APP_BOT)).action, 'created');
  assert.deepEqual(requests, [GET(1), POST]);
});

test('a human author matches only after GET /user returns the same login (case may differ), then only User comments by it', async () => {
  const reviewer = { login: 'demo-reviewer', type: 'User' };
  const pages = [[bot(5, OLD_BODY), byUser(6, OLD_BODY, { login: 'demo-reviewer', type: 'Bot' }), person(10, OLD_BODY)]];
  const { client, requests } = fakeApi(pages, { user: { login: 'demo-reviewer', type: 'User' }, writer: reviewer });
  const confirmed = await confirmCommentAuthor(client, { login: 'Demo-Reviewer', type: 'User' });
  assert.deepEqual(confirmed, reviewer, 'GitHub spelling of the login');
  assert.deepEqual(await upsert(client, BODY, confirmed), {
    action: 'updated', id: 10, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-10', duplicates: 0, author: 'demo-reviewer',
  });
  assert.deepEqual(requests, [GET_USER, GET(1), PATCH(10)]);
});

const CONFIRM_FAILURES = [
  ['another login', { user: { login: 'someone-else', type: 'User' } }, null,
    "PRCHECK_COMMENT_AUTHOR is demo-reviewer, but the token's account could not be confirmed as demo-reviewer (GET /user returned someone-else)"],
  ['no login in the answer', { user: { type: 'User' } }, null,
    "PRCHECK_COMMENT_AUTHOR is demo-reviewer, but the token's account could not be confirmed as demo-reviewer (GET /user returned no login)"],
  ['a 403 on GET /user', { fail: { GET: [{ status: 403, message: 'Resource not accessible by integration' }] } }, 403,
    "PRCHECK_COMMENT_AUTHOR is demo-reviewer, but the token's account could not be confirmed as demo-reviewer (GitHub API GET /user failed with status 403: Resource not accessible by integration)"],
];

for (const [label, options, status, message] of CONFIRM_FAILURES) {
  test(`a human author with ${label} throws, with no list, POST or PATCH`, async () => {
    const { client, requests } = fakeApi([[person(10, OLD_BODY)]], options);
    await assert.rejects(confirmCommentAuthor(client, { login: 'demo-reviewer', type: 'User' }), (error) => {
      assert.ok(error instanceof GitHubError);
      assert.equal(error.message, message);
      assert.deepEqual([error.status, error.method, error.rateLimited], [status, 'GET', false]);
      assert.ok(!error.message.includes(TOKEN));
      return true;
    });
    assert.deepEqual(requests, [GET_USER]);
  });
}

// The POST rule (S2): a POST is never sent twice without a fresh list between them.

test('POST 502, then a re-list that finds the comment the first POST made: one PATCH and no second POST', async () => {
  const pages = [[]];
  const { client, requests, waits } = fakeApi(pages, { fail: { POST: [{ status: 502, then: () => pages[0].push(bot(900, BODY)) }] } });
  assert.deepEqual(await upsert(client), {
    action: 'updated', id: 900, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-900', duplicates: 0, author: 'github-actions[bot]',
  });
  assert.deepEqual(requests, [GET(1), POST, GET(1), PATCH(900)]);
  assert.deepEqual(waits, [2000]);
});

test('POST 502 and no match on the re-list: exactly one more POST', async () => {
  const { client, requests, waits } = fakeApi([[]], { fail: { POST: [{ status: 502 }] } });
  assert.equal((await upsert(client)).action, 'created');
  assert.deepEqual(requests, [GET(1), POST, GET(1), POST]);
  assert.deepEqual(waits, [2000]);
});

test('POST 429 with retry-after: 3 waits 3000 ms before the re-list', async () => {
  const { client, requests, waits } = fakeApi([[]], { fail: { POST: [{ status: 429, headers: { 'retry-after': '3' } }] } });
  assert.equal((await upsert(client)).action, 'created');
  assert.deepEqual([requests.map((r) => r.method), waits], [['GET', 'POST', 'GET', 'POST'], [3000]]);
});

test('a second POST failure is thrown, after exactly two POSTs with a list between them', async () => {
  const { client, requests } = fakeApi([[]], { fail: { POST: [{ status: 502 }, { status: 502 }] } });
  await assert.rejects(upsert(client), (error) => {
    assert.equal(error.message, `GitHub API POST ${LIST} failed with status 502: Server Error`);
    return true;
  });
  assert.deepEqual(requests.map((r) => r.method), ['GET', 'POST', 'GET', 'POST']);
});

for (const [status, message] of [[422, 'Validation Failed'], [403, 'Resource not accessible by integration']]) {
  test(`a POST ${status} is thrown at once, with no wait and no re-list`, async () => {
    const { client, requests, waits } = fakeApi([[]], { fail: { POST: [{ status, message }] } });
    await assert.rejects(upsert(client), (error) => {
      assert.deepEqual([error.status, error.method, error.rateLimited, error.retryable], [status, 'POST', false, false]);
      assert.equal(error.message, `GitHub API POST ${LIST} failed with status ${status}: ${message}`);
      return true;
    });
    assert.deepEqual([requests.map((r) => r.method), waits], [['GET', 'POST'], []]);
  });
}

// A secondary rate limit 403 with no rate limit header (PR 7a): rate limited by its message, so the POST
// rule applies; never thrown at once as a permission error.
const SECONDARY_403 = { status: 403, message: 'You have exceeded a secondary rate limit' };

test('POST secondary rate limit 403 with no headers, then a re-list that finds the comment: one wait of 60000 ms and one PATCH', async () => {
  const pages = [[]];
  const { client, requests, waits } = fakeApi(pages, { fail: { POST: [{ ...SECONDARY_403, then: () => pages[0].push(bot(900, BODY)) }] } });
  assert.deepEqual(await upsert(client), {
    action: 'updated', id: 900, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-900', duplicates: 0, author: 'github-actions[bot]',
  });
  assert.deepEqual(requests, [GET(1), POST, GET(1), PATCH(900)]);
  assert.deepEqual(waits, [60000]);
});

test('POST secondary rate limit 403 with no headers and no match on the re-list: one wait of 60000 ms and exactly one more POST', async () => {
  const { client, requests, waits } = fakeApi([[]], { fail: { POST: [SECONDARY_403] } });
  assert.equal((await upsert(client)).action, 'created');
  assert.deepEqual(requests, [GET(1), POST, GET(1), POST]);
  assert.deepEqual(waits, [60000]);
});

test('two POST secondary rate limit 403s throw rateLimited, after two POSTs with a list between them', async () => {
  const { client, requests, waits } = fakeApi([[]], { fail: { POST: [SECONDARY_403, SECONDARY_403] } });
  await assert.rejects(upsert(client), (error) => {
    assert.ok(error instanceof GitHubError);
    assert.equal(error.message, `GitHub API POST ${LIST} failed with status 403: You have exceeded a secondary rate limit`);
    assert.deepEqual([error.status, error.method, error.rateLimited, error.retryable], [403, 'POST', true, true]);
    assert.ok(!`${error.message}\n${error.stack}`.includes(TOKEN));
    return true;
  });
  assert.deepEqual([requests.map((r) => r.method), waits], [['GET', 'POST', 'GET', 'POST'], [60000]]);
});

test('PATCH secondary rate limit 403s with no headers: 3 attempts with waits of 60000 and 60000 ms, then thrown rateLimited', async () => {
  const { client, requests, waits } = fakeApi([[bot(5, OLD_BODY)]], { fail: { PATCH: [SECONDARY_403, SECONDARY_403, SECONDARY_403] } });
  await assert.rejects(upsert(client), (error) => {
    assert.equal(error.message, 'GitHub API PATCH /repos/demo-owner/demo-shop/issues/comments/5 failed with status 403: You have exceeded a secondary rate limit (3 attempts)');
    assert.deepEqual([error.status, error.method, error.rateLimited], [403, 'PATCH', true]);
    return true;
  });
  assert.deepEqual([requests.map((r) => r.method), waits], [['GET', 'PATCH', 'PATCH', 'PATCH'], [60000, 60000]]);
});

test('the created comment\'s author is returned as GitHub gives it', async () => {
  const { client } = fakeApi([[]], { writer: { login: 'other-app[bot]', type: 'Bot' } });
  assert.equal((await upsert(client)).author, 'other-app[bot]');
});
