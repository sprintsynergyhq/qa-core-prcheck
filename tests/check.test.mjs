import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkErrorLine, formatCheckJson, runCheck } from '../dist/check/index.js';
import { readDiffFile } from '../dist/diff/index.js';
import { ImpactError } from '../dist/impact/index.js';
import { cleanup } from './helpers/git-repo.mjs';

/**
 * runCheck with the fake Playwright CLI in tests/fixtures/fake-playwright/cli.mjs for the test run.
 * The selection is real: the inventory is read from the demo suite with Playwright's --list, which
 * opens no browser. No real test runs here.
 */

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fakeCli = path.join(repoRoot, 'tests', 'fixtures', 'fake-playwright', 'cli.mjs');
const summaryDir = path.join(repoRoot, 'tests', 'fixtures', 'summary');
const LIVE = { timeout: 120_000 };
const VERSION = '0.0.0-test';
const lines = (...ls) => ls.map((l) => `${l}\n`).join('');
const goldenOf = (name) => fs.readFileSync(path.join(summaryDir, `${name}.md`), 'utf8');

function newDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  return dir;
}

/** A copy of a recorded report with /repo/ and /project/ made into this checkout's root. */
function reportCopy(t, name) {
  const text = fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'results', name), 'utf8');
  const file = path.join(newDir(t), name);
  fs.writeFileSync(file, text.split('"/repo/').join(`"${repoRoot}/`).split('"/project/').join(`"${repoRoot}/`));
  return file;
}

const diffOf = (name) => readDiffFile(`tests/fixtures/diffs/${name}`, repoRoot);

/** Runs a check with the fake CLI and returns it with the fake's records, after checking the temp folder is gone. */
async function checkWithFake(t, diffName, fakeEnv = {}, options = {}) {
  const record = path.join(newDir(t), 'record.jsonl');
  const checked = await runCheck({
    root: repoRoot,
    diff: await diffOf(diffName),
    env: { FAKE_PW_RECORD: record, ...fakeEnv },
    playwrightCli: fakeCli,
    version: VERSION,
    ...options,
  });
  const records = fs.existsSync(record)
    ? fs.readFileSync(record, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    : [];
  for (const { env } of records) {
    const tempFolder = path.dirname(env.PLAYWRIGHT_JSON_OUTPUT_FILE);
    assert.ok(path.basename(tempFolder).startsWith('prcheck-run-'), tempFolder);
    assert.equal(fs.existsSync(tempFolder), false, `temp folder left behind: ${tempFolder}`);
  }
  return { ...checked, records };
}

test('modify.diff with the demo cart report: Passed, exit 0, and the passed golden', LIVE, async (t) => {
  const { selection, result, summary, records } = await checkWithFake(t, 'modify.diff', { FAKE_PW_REPORT: reportCopy(t, 'demo-cart.json') });
  assert.equal(records.length, 1);
  assert.equal(selection.mode, 'subset');
  assert.deepEqual([result.verdict, result.exitCode], ['passed', 0]);
  assert.equal(summary.verdict, 'passed');
  assert.equal(summary.markdown, goldenOf('passed'));
});

test('the synthetic report with a failed test and Playwright exit 1: Failed, exit 1', LIVE, async (t) => {
  const { result, summary } = await checkWithFake(t, 'modify.diff', { FAKE_PW_REPORT: reportCopy(t, 'synthetic-mixed.json'), FAKE_PW_EXIT: '1' });
  assert.deepEqual([result.verdict, result.exitCode], ['failed', 1]);
  assert.equal(summary.verdict, 'failed');
  assert.equal(summary.markdown.split('\n')[1], '## PR Check: Failed');
});

test('delete.diff: No Tests Needed, exit 0, and the fake never starts', LIVE, async (t) => {
  const { result, summary, records } = await checkWithFake(t, 'delete.diff', { FAKE_PW_EXIT: '1' });
  assert.deepEqual(records, []);
  assert.deepEqual([result.verdict, result.exitCode], ['nothing-to-run', 0]);
  assert.equal(summary.markdown, goldenOf('no-tests-needed'));
});

test('dryRun: Not Run, exit 0, and the fake never starts', LIVE, async (t) => {
  const { result, summary, records } = await checkWithFake(t, 'modify.diff', { FAKE_PW_EXIT: '1' }, { dryRun: true });
  assert.deepEqual(records, []);
  assert.deepEqual([result.verdict, result.exitCode], ['not-run', 0]);
  assert.equal(summary.markdown, goldenOf('not-run'));
});

test('the top-level error report: Error, exit 2, and the error golden', LIVE, async (t) => {
  const { result, summary, records } = await checkWithFake(t, 'modify.diff', { FAKE_PW_REPORT: reportCopy(t, 'top-level-error.json'), FAKE_PW_EXIT: '1' });
  assert.equal(records.length, 1);
  assert.deepEqual([result.verdict, result.exitCode], ['error', 2]);
  assert.equal(summary.markdown, goldenOf('error'));
});

/**
 * A made-up @playwright/test in a temp root. Its cli.js appends its arguments to FAKE_RECORD, prints a
 * one-test list for --list and writes a passing report for a test run. selectTests is the only caller
 * of --list, so one --list line per check proves the check picked the specs exactly once.
 */
function recordingProject(t) {
  const dir = newDir(t);
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write('node_modules/@playwright/test/package.json', JSON.stringify({ name: '@playwright/test', version: '0.0.0', exports: { './cli': './cli.js' } }));
  write('node_modules/@playwright/test/cli.js', lines(
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "fs.appendFileSync(process.env.FAKE_RECORD, JSON.stringify(process.argv.slice(2)) + '\\n');",
    "const rootDir = path.join(process.cwd(), 'demo', 'saucedemo', 'tests');",
    "const results = [{ status: 'passed', duration: 5 }];",
    "const spec = { title: 'adds a backpack', ok: true, tags: ['cart'], file: 'cart/cart.spec.ts', line: 3,",
    "  tests: [{ projectName: 'chromium', status: 'expected', expectedStatus: 'passed', results }] };",
    "const report = { config: { rootDir }, suites: [{ title: 'cart/cart.spec.ts', file: 'cart/cart.spec.ts', specs: [spec] }], errors: [], stats: { duration: 12 } };",
    "if (process.argv.includes('--list')) process.stdout.write(JSON.stringify(report));",
    'else fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify(report));',
  ));
  write('demo/saucedemo/playwright.config.ts', lines('export default {};'));
  write('demo/saucedemo/pages/cart-page.ts', lines('export class CartPage {}'));
  write('demo/saucedemo/tests/cart/cart.spec.ts', lines("import { CartPage } from '../../pages/cart-page';"));
  return dir;
}

test('one check runs Playwright --list once (selectTests) and the test run once', LIVE, async (t) => {
  const root = recordingProject(t);
  const record = path.join(newDir(t), 'calls.jsonl');
  const { result, summary } = await runCheck({ root, diff: await diffOf('modify.diff'), env: { FAKE_RECORD: record }, version: VERSION });
  const calls = fs.readFileSync(record, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(calls.length, 2, JSON.stringify(calls));
  assert.equal(calls.filter((argv) => argv.includes('--list')).length, 1);
  assert.deepEqual(calls[1].slice(0, 1), ['test']);
  assert.ok(!calls[1].includes('--list'));
  assert.deepEqual([result.verdict, result.exitCode, result.counts.total], ['passed', 0, 1]);
  assert.equal(summary.verdict, 'passed');
});

test('an error before the run is thrown, and checkErrorLine shows the absolute root as <root>', async (t) => {
  const root = path.join(newDir(t), 'missing');
  const diff = await diffOf('delete.diff');
  await assert.rejects(runCheck({ root, diff, version: VERSION }), (error) => {
    assert.ok(error instanceof ImpactError, `expected ImpactError, got ${error}`);
    assert.equal(error.message, `Root folder not found: ${root}`);
    assert.equal(checkErrorLine(error.message, root), 'Root folder not found: <root>');
    return true;
  });
});

test('checkErrorLine keeps the first line, removes color codes and makes paths in the root relative', () => {
  const root = '/work/shop';
  assert.equal(checkErrorLine('\u001b[31mError: /work/shop/demo/a.spec.ts failed\u001b[39m\nsecond line', root), 'Error: demo/a.spec.ts failed');
  assert.equal(checkErrorLine('Unknown ref: nope. Fetch it first, for example git fetch origin <branch>', root), 'Unknown ref: nope. Fetch it first, for example git fetch origin <branch>');
});

test('formatCheckJson: keys in the documented order, file null and stepSummary false without files', () => {
  const { selection, result } = JSON.parse(fs.readFileSync(path.join(summaryDir, 'inputs', 'not-run.json'), 'utf8'));
  const summary = { markdown: goldenOf('not-run'), verdict: 'not-run', fullSuite: false, truncated: false, omitted: 0 };
  const text = formatCheckJson(selection, result, summary, null, 0);
  assert.ok(text.endsWith('}\n'));
  const json = JSON.parse(text);
  assert.deepEqual(Object.keys(json), ['schemaVersion', 'selection', 'result', 'summary', 'exitCode']);
  assert.deepEqual(json.summary, {
    verdict: 'not-run', fullSuite: false, truncated: false, omitted: 0,
    bytes: Buffer.byteLength(goldenOf('not-run')), file: null, stepSummary: false,
  });
  assert.deepEqual([json.schemaVersion, json.selection, json.result, json.exitCode], [1, selection, result, 0]);
  const written = JSON.parse(formatCheckJson(selection, result, summary, { summaryFile: 'prcheck-summary.md', stepSummary: true, artifacts: [] }, 2));
  assert.deepEqual([written.summary.file, written.summary.stepSummary, written.exitCode], ['prcheck-summary.md', true, 2]);
});
