import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCheck } from '../dist/check/index.js';
import { readDiffFile, readGitDiff } from '../dist/diff/index.js';
import { cleanup, createTempRepo } from './helpers/git-repo.mjs';

/**
 * runCheck and the check command with the real Playwright 1.60.0. The first test uses a made-up project
 * in a temp git repo whose specs open no browser and use no network, so it runs in npm test and in CI.
 * The last test runs the demo suite against saucedemo.com and only runs when PRCHECK_LIVE=1.
 */

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliJs = path.join(repoRoot, 'dist', 'cli.js');
const lines = (...ls) => ls.map((l) => `${l}\n`).join('');
// Real Playwright runs get a generous node:test limit; no test waits on a timer.
const REAL = { timeout: 120_000 };
const VERSION = '0.0.0-test';

// The synthetic project: the same sources as in tests/fixtures/results/README.md, repeated here so this
// file does not depend on another test file.
const CONFIG = lines(
  "import { defineConfig } from '@playwright/test';",
  '',
  'export default defineConfig({',
  "  testDir: './tests',",
  '  retries: 1,',
  '  projects: [',
  "    { name: 'desktop' },",
  "    { name: 'smoke', grep: /@cart/ },",
  '  ],',
  '});',
);
const CART_SOURCE = lines(
  "import { expect, test } from '@playwright/test';",
  '',
  "test.describe('cart', () => {",
  "  test('adds a backpack to the cart', { tag: '@cart' }, () => {",
  "    const cart = ['sauce-labs-backpack'];",
  '    expect(cart).toHaveLength(1);',
  '  });',
  '',
  "  test('shows the badge after a retry', ({}, testInfo) => {",
  '    expect(testInfo.retry).toBe(1);',
  '  });',
  '',
  "  test.skip('applies a promo code', () => {",
  '    expect(true).toBe(true);',
  '  });',
  '',
  "  test('sells the onesie for free', () => {",
  '    test.fail();',
  '    expect(7.99).toBe(0);',
  '  });',
  '});',
);
const CHECKOUT_SOURCE = lines(
  "import { expect, test } from '@playwright/test';",
  '',
  "test.describe('checkout', () => {",
  "  test('counts the items in the cart', () => {",
  '    const cartCount = 1;',
  '    expect(cartCount).toBe(2);',
  '  });',
  '',
  "  test('waits for the payment page', async () => {",
  '    test.setTimeout(500);',
  '    await new Promise(() => {});',
  '  });',
  '});',
);
const CART = 'demo/shop/tests/cart/cart.spec.ts';
const CHECKOUT = 'demo/shop/tests/checkout/checkout.spec.ts';

// Written by hand from the sources above: the failing assertion is on line 4 of the checkout spec.
const FAILURE_ROW = '| failed | checkout &gt; counts the items in the cart [desktop] | `demo/shop/tests/checkout/checkout.spec.ts:4` | Error: expect(received).toBe(expected) // Object.is equality |';

function newDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  return dir;
}

/** A fake git, first on PATH, that records each call in a marker file and fails. A node script, not a shell script. */
function fakeGit(t) {
  const dir = newDir(t);
  const marker = path.join(dir, 'git-calls.txt');
  fs.writeFileSync(marker, '');
  assert.ok(!process.execPath.includes(' '), `a #! line cannot hold a path with spaces: ${process.execPath}`);
  fs.writeFileSync(path.join(dir, 'git'), lines(
    `#!${process.execPath}`,
    "const fs = require('node:fs');",
    `fs.appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' ') + '\\n');`,
    'process.exitCode = 1;',
  ), { mode: 0o755 });
  return { path: `${dir}${path.delimiter}${process.env.PATH}`, marker };
}

// Taken out of the child env first, so only what a case sets reaches it; GITHUB_STEP_SUMMARY included,
// so a CI host's own job summary is never written to.
const HOST_KEYS = [
  'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL', 'BUILD_URL', 'PW_TEST_REPORTER',
  'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR', 'GITHUB_STEP_SUMMARY',
];

const runCli = (args, { cwd, env }) => new Promise((resolve) => {
  const child = spawn(process.execPath, [cliJs, ...args], { cwd, env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

test('real Playwright: a change to the failing spec gives Failed with its row and exit 1, from runCheck and the CLI, and no git runs', REAL, async (t) => {
  const repo = createTempRepo();
  t.after(() => cleanup(repo.dir));
  // Ignored first, so the linked packages and Playwright's output folder are never committed.
  repo.write('.gitignore', lines('node_modules', 'test-results'));
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(repo.dir, 'node_modules'), 'dir');
  repo.write('qa-core-prcheck.config.json', JSON.stringify({ playwrightDir: 'demo/shop' }));
  repo.write('demo/shop/playwright.config.ts', CONFIG);
  repo.write(CART, CART_SOURCE);
  repo.write(CHECKOUT, CHECKOUT_SOURCE);
  repo.commitAll('base');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write(CHECKOUT, CHECKOUT_SOURCE.replace('const cartCount = 1;', 'const cartCount = 1; // one backpack'));
  repo.commitAll('feature');

  // The real git reads the diff first. Then the fake git goes first on PATH, with the CI variables that
  // would make Playwright run git if they were not removed.
  const diff = await readGitDiff({ base: 'main', head: 'feature', cwd: repo.dir, env: repo.env });
  const git = fakeGit(t);
  const ciEnv = { GITHUB_ACTIONS: 'true', GITLAB_CI: 'true', JENKINS_URL: 'http://jenkins.invalid', BUILD_URL: 'http://jenkins.invalid/1', CI: 'true' };

  const { selection, result, summary } = await runCheck({ root: repo.dir, diff, env: { PATH: git.path, ...ciEnv }, version: VERSION });
  assert.deepEqual(result.errors, []);
  assert.deepEqual([selection.mode, result.specs], ['subset', [CHECKOUT]]);
  assert.deepEqual([result.verdict, result.exitCode, summary.verdict], ['failed', 1, 'failed']);
  assert.equal(summary.markdown.split('\n')[1], '## PR Check: Failed');
  assert.ok(summary.markdown.includes(`\n${FAILURE_ROW}\n`), summary.markdown);

  // The CLI reads the same change from a saved diff, so it never needs git and the fake stays first.
  // The flags are those readGitDiff uses; main is the merge base here.
  const work = newDir(t);
  const diffPath = path.join(work, 'change.diff');
  fs.writeFileSync(diffPath, `${repo.git(
    'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative', '--find-renames',
    '--src-prefix=a/', '--dst-prefix=b/', '--unified=0', 'main', 'feature', '--',
  )}\n`);
  const env = { ...process.env, PATH: git.path, ...ciEnv };
  for (const key of HOST_KEYS) if (!(key in ciEnv)) delete env[key];
  const summaryFile = path.join(work, 'summary.md');
  const r = await runCli(['check', '--diff-file', diffPath, '--root', repo.dir, '--summary-file', summaryFile], { cwd: work, env });
  assert.equal(r.stderr, '');
  assert.equal(r.status, 1);
  assert.equal(fs.readFileSync(summaryFile, 'utf8'), r.stdout);
  assert.equal(r.stdout.split('\n')[1], '## PR Check: Failed');
  assert.ok(r.stdout.includes(`\n${FAILURE_ROW}\n`), r.stdout);

  assert.equal(fs.readFileSync(git.marker, 'utf8'), '', 'Playwright ran git');
});

const LIVE_ON = process.env.PRCHECK_LIVE === '1';
// The node:test limit for the live run. A chosen limit; Playwright's own timeouts are the demo config's.
const LIVE_LIMIT_MS = 300_000;

test('live: modify.diff checks the cart and checkout specs against saucedemo.com and they pass', {
  skip: LIVE_ON ? false : 'set PRCHECK_LIVE=1 to run against saucedemo.com',
  timeout: LIVE_LIMIT_MS,
}, async () => {
  const diff = await readDiffFile('tests/fixtures/diffs/modify.diff', repoRoot);
  const { result, summary } = await runCheck({ root: repoRoot, diff, version: VERSION });
  assert.deepEqual(result.errors, []);
  assert.deepEqual([result.verdict, result.exitCode, summary.verdict], ['passed', 0, 'passed']);
  assert.equal(summary.markdown.split('\n')[1], '## PR Check: Passed');
  // The two specs PR 3 picks for modify.diff, two tests each (tests/run-real.test.mjs).
  assert.ok(summary.markdown.includes(lines(
    '| `demo/saucedemo/tests/cart/cart.spec.ts` | 2 | passed | demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/cart/cart.spec.ts |',
    '| `demo/saucedemo/tests/checkout/checkout.spec.ts` | 2 | passed | demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/checkout/checkout.spec.ts |',
  )), summary.markdown);
  assert.equal(summary.markdown.split('\n')[3], 'Every picked test passed: 4 tests in 2 specs.');
});
