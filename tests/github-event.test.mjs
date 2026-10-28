import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubError, readPullRequestEvent } from '../dist/github/index.js';

/**
 * readPullRequestEvent on payloads written by hand in the shape of the pull request object in the GitHub
 * docs (https://docs.github.com/en/rest/pulls/pulls), with only the fields it reads plus a few others.
 * Made-up SauceDemo style names only.
 */

const repoOf = (fullName) => ({ full_name: fullName, name: fullName.split('/')[1], owner: { login: fullName.split('/')[0] } });

function eventWith({ number = 7, head = repoOf('demo-owner/demo-shop'), base = repoOf('demo-owner/demo-shop') } = {}) {
  return {
    action: 'synchronize',
    number,
    pull_request: {
      number,
      title: 'Add the backpack to the cart page',
      head: { ref: 'feature/cart', repo: head },
      base: { ref: 'main', repo: base },
    },
    repository: base,
  };
}

test('a pull request from a branch of the same repository is not a fork', () => {
  assert.deepEqual(readPullRequestEvent(eventWith(), 'pull_request'), {
    owner: 'demo-owner', repo: 'demo-shop', number: 7, baseRepo: 'demo-owner/demo-shop', headRepo: 'demo-owner/demo-shop', isFork: false,
  });
});

test('a pull request from another repository is a fork', () => {
  assert.deepEqual(readPullRequestEvent(eventWith({ head: repoOf('fork-owner/demo-shop') }), 'pull_request'), {
    owner: 'demo-owner', repo: 'demo-shop', number: 7, baseRepo: 'demo-owner/demo-shop', headRepo: 'fork-owner/demo-shop', isFork: true,
  });
});

test('a head repository of null (a deleted fork) is a fork', () => {
  assert.deepEqual(readPullRequestEvent(eventWith({ head: null }), 'pull_request'), {
    owner: 'demo-owner', repo: 'demo-shop', number: 7, baseRepo: 'demo-owner/demo-shop', headRepo: null, isFork: true,
  });
});

for (const eventName of ['push', 'pull_request_target', 'workflow_dispatch', '']) {
  test(`event name ${JSON.stringify(eventName)} gives null, even with a pull_request payload`, () => {
    assert.equal(readPullRequestEvent(eventWith(), eventName), null);
  });
}

const BROKEN = [
  ['no payload', null, 'pull_request'],
  ['no pull_request', { action: 'opened' }, 'pull_request'],
  ['no number', (() => { const e = eventWith(); delete e.pull_request.number; return e; })(), 'pull_request.number'],
  ['a number that is a string', (() => { const e = eventWith(); e.pull_request.number = '7'; return e; })(), 'pull_request.number'],
  ['no base', (() => { const e = eventWith(); delete e.pull_request.base; return e; })(), 'pull_request.base'],
  ['no base repo', (() => { const e = eventWith(); delete e.pull_request.base.repo; return e; })(), 'pull_request.base.repo.full_name'],
  ['a base full_name without a slash', eventWith({ base: { full_name: 'demo-shop' } }), 'pull_request.base.repo.full_name'],
  ['no head', (() => { const e = eventWith(); delete e.pull_request.head; return e; })(), 'pull_request.head'],
  ['no head repo key', (() => { const e = eventWith(); delete e.pull_request.head.repo; return e; })(), 'pull_request.head.repo.full_name'],
];

for (const [label, event, field] of BROKEN) {
  test(`a pull_request event with ${label} throws GitHubError naming ${field}`, () => {
    assert.throws(() => readPullRequestEvent(event, 'pull_request'), (error) => {
      assert.ok(error instanceof GitHubError, `expected GitHubError, got ${error}`);
      assert.equal(error.message, `The pull_request event has no ${field}`);
      assert.equal(error.status, null);
      return true;
    });
  });
}
