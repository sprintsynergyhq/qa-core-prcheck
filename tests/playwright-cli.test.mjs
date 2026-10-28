import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanPlaywrightEnv, findPlaywrightCli, PlaywrightError, REMOVED_ENV_KEYS, runPlaywright,
} from '../dist/playwright/cli.js';
import { cleanup } from './helpers/git-repo.mjs';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fakeCli = path.join(repoRoot, 'tests', 'fixtures', 'fake-playwright', 'cli.mjs');
// The kill timeout used against the hanging fake. A chosen limit, long enough for node to start.
const HANG_TIMEOUT_MS = 1_000;

const NINE_KEYS = [
  'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL', 'BUILD_URL', 'PW_TEST_REPORTER',
  'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR',
];

function newDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  return dir;
}

test('REMOVED_ENV_KEYS lists exactly the nine variables', () => {
  assert.deepEqual([...REMOVED_ENV_KEYS], NINE_KEYS);
});

test('cleanPlaywrightEnv removes all nine keys, keeps the rest and adds extra', () => {
  const base = { PATH: '/usr/bin', SAUCE_USER: 'standard_user' };
  for (const key of NINE_KEYS) base[key] = 'set';
  assert.deepEqual(cleanPlaywrightEnv(base, { PLAYWRIGHT_JSON_OUTPUT_FILE: '/tmp/report.json' }), {
    PATH: '/usr/bin',
    SAUCE_USER: 'standard_user',
    PLAYWRIGHT_JSON_OUTPUT_FILE: '/tmp/report.json',
  });
  assert.deepEqual(cleanPlaywrightEnv(base), { PATH: '/usr/bin', SAUCE_USER: 'standard_user' });
});

test('cleanPlaywrightEnv does not change the input object', () => {
  const base = { CI: 'true', GITHUB_ACTIONS: 'true', PATH: '/usr/bin' };
  cleanPlaywrightEnv(base, { PLAYWRIGHT_JSON_OUTPUT_FILE: 'report.json' });
  assert.deepEqual(base, { CI: 'true', GITHUB_ACTIONS: 'true', PATH: '/usr/bin' });
});

test('findPlaywrightCli finds the CLI of the installed @playwright/test from this repo', () => {
  assert.equal(findPlaywrightCli(repoRoot), path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js'));
});

test('findPlaywrightCli from an empty folder throws PlaywrightError with the npm ci hint', (t) => {
  const dir = newDir(t);
  assert.throws(() => findPlaywrightCli(dir), (error) => {
    assert.ok(error instanceof PlaywrightError, `expected PlaywrightError, got ${error}`);
    assert.equal(error.message, `@playwright/test was not found from ${dir}. Run npm ci first.`);
    return true;
  });
});

test('runPlaywright passes the argument array as given and returns exit code 0', async (t) => {
  const dir = newDir(t);
  const record = path.join(dir, 'record.jsonl');
  // An explicit env with nothing from the host, so a CI runner's own variables cannot reach the record.
  const env = { FAKE_PW_RECORD: record, CI: 'kept as given' };
  const run = await runPlaywright(dir, [fakeCli, 'test', '--config', 'demo/shop', 'a b.spec.ts'], env, 0);
  assert.deepEqual(run, { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false });
  // runPlaywright runs with the env it is given; cleaning it is the caller's job.
  assert.deepEqual(JSON.parse(fs.readFileSync(record, 'utf8')), {
    argv: ['test', '--config', 'demo/shop', 'a b.spec.ts'],
    env: { CI: 'kept as given' },
  });
});

test('runPlaywright resolves a non-zero exit with its code and stderr, and never rejects for it', async (t) => {
  const dir = newDir(t);
  const env = { ...process.env, FAKE_PW_EXIT: '3', FAKE_PW_STDERR: 'Error: the cart page is missing\n' };
  const run = await runPlaywright(dir, [fakeCli], env, 0);
  assert.deepEqual(run, {
    exitCode: 3, signal: null, stdout: '', stderr: 'Error: the cart page is missing\n', timedOut: false,
  });
});

test('runPlaywright stops a hanging process at the kill timeout and reports timedOut', async (t) => {
  const dir = newDir(t);
  const run = await runPlaywright(dir, [fakeCli], { ...process.env, FAKE_PW_HANG: '1' }, HANG_TIMEOUT_MS);
  assert.deepEqual(run, { exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '', timedOut: true });
});

test('runPlaywright rejects with PlaywrightError when the process cannot start', async (t) => {
  const missing = path.join(newDir(t), 'missing');
  await assert.rejects(runPlaywright(missing, [fakeCli], process.env, 0), (error) => {
    assert.ok(error instanceof PlaywrightError, `expected PlaywrightError, got ${error}`);
    assert.ok(error.message.startsWith('Playwright could not start: '), error.message);
    assert.ok(!error.message.includes('\n'), error.message);
    return true;
  });
});
