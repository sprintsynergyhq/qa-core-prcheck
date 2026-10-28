import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_LOGIN, BOT_TYPE, createGitHubClient, findStickyComment, GitHubError, upsertStickyComment,
} from '../dist/github/index.js';
import { MAX_SUMMARY_BYTES, SUMMARY_MARKER } from '../dist/report/index.js';

/**
 * The sticky comment logic with a fake GitHub API behind an injected fetch. The fake serves the issue
 * comments of one pull request in pages and records every request. No network.
 */

const TOKEN = 'ghs_fake_token_for_tests';
const API = 'https://api.github.com';
const LIST = '/repos/demo-owner/demo-shop/issues/7/comments';
const BODY = `${SUMMARY_MARKER}\n## PR Check: Passed\n`;
const OLD_BODY = `${SUMMARY_MARKER}\n## PR Check: Failed\n`;

const bot = (id, body) => ({ id, body, html_url: `https://github.com/demo-owner/demo-shop/pull/7#issuecomment-${id}`, user: { login: 'github-actions[bot]', type: 'Bot' } });
const person = (id, body) => ({ id, body, html_url: `https://github.com/demo-owner/demo-shop/pull/7#issuecomment-${id}`, user: { login: 'demo-reviewer', type: 'User' } });

/** A fake API holding pages of comments. POST answers id 900; PATCH echoes the id from the path. */
function fakeApi(pages) {
  const requests = [];
  const fetchFn = async (url, init) => {
    const u = new URL(url);
    requests.push({ method: init.method, path: `${u.pathname}${u.search}`, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    if (init.method === 'GET' && u.pathname === LIST) {
      const page = Number(u.searchParams.get('page') ?? '1');
      const headers = page < pages.length ? { link: `<${API}${LIST}?per_page=100&page=${page + 1}>; rel="next"` } : {};
      return new Response(JSON.stringify(pages[page - 1] ?? []), { status: 200, headers });
    }
    if (init.method === 'POST' && u.pathname === LIST) {
      return new Response(JSON.stringify(bot(900, JSON.parse(init.body).body)), { status: 201 });
    }
    const patched = u.pathname.match(/^\/repos\/demo-owner\/demo-shop\/issues\/comments\/(\d+)$/);
    if (init.method === 'PATCH' && patched) {
      return new Response(JSON.stringify(bot(Number(patched[1]), JSON.parse(init.body).body)), { status: 200 });
    }
    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  };
  return { client: createGitHubClient({ token: TOKEN, apiUrl: API, fetch: fetchFn }), requests };
}

const upsert = (client, body = BODY) => upsertStickyComment({ client, owner: 'demo-owner', repo: 'demo-shop', number: 7, body });
const GET = (page) => ({ method: 'GET', path: page === 1 ? `${LIST}?per_page=100` : `${LIST}?per_page=100&page=${page}`, body: undefined });

test('the bot is github-actions[bot] of type Bot', () => {
  assert.deepEqual([BOT_LOGIN, BOT_TYPE], ['github-actions[bot]', 'Bot']);
});

test('no comments: one GET, then one POST with the body', async () => {
  const { client, requests } = fakeApi([[]]);
  assert.deepEqual(await upsert(client), {
    action: 'created', id: 900, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-900', duplicates: 0,
  });
  assert.deepEqual(requests, [GET(1), { method: 'POST', path: LIST, body: { body: BODY } }]);
});

test('a bot comment with the marker: one PATCH to its id, no POST', async () => {
  const { client, requests } = fakeApi([[person(10, 'Looks good'), bot(55, OLD_BODY)]]);
  assert.deepEqual(await upsert(client), {
    action: 'updated', id: 55, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-55', duplicates: 0,
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
    action: 'updated', id: 3001, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-3001', duplicates: 0,
  });
  assert.deepEqual(requests, [
    GET(1), GET(2), GET(3),
    { method: 'PATCH', path: '/repos/demo-owner/demo-shop/issues/comments/3001', body: { body: BODY } },
  ]);
});

test('two matches: the oldest (lowest id) is updated and the other is counted as a duplicate', async () => {
  const { client, requests } = fakeApi([[bot(77, OLD_BODY), bot(60, OLD_BODY)]]);
  assert.deepEqual(await upsert(client), {
    action: 'updated', id: 60, url: 'https://github.com/demo-owner/demo-shop/pull/7#issuecomment-60', duplicates: 1,
  });
  assert.equal(requests.at(-1).path, '/repos/demo-owner/demo-shop/issues/comments/60');
});

test('findStickyComment is pure and skips items that are not comments', () => {
  const comments = [null, 'text', { id: 'x' }, person(1, BODY), bot(9, BODY), bot(3, BODY)];
  const copy = structuredClone(comments);
  assert.deepEqual(findStickyComment(comments, SUMMARY_MARKER), { comment: bot(3, BODY), duplicates: 1 });
  assert.deepEqual(comments, copy);
  assert.equal(findStickyComment([], SUMMARY_MARKER), null);
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
