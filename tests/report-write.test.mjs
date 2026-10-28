import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSelectionJson } from '../dist/impact/index.js';
import { ReportError, writeSummaryFiles } from '../dist/report/index.js';
import { formatRunJson } from '../dist/run/index.js';
import { cleanup } from './helpers/git-repo.mjs';

/**
 * writeSummaryFiles in temp folders only. Every env is an explicit object, so a GITHUB_STEP_SUMMARY
 * set by a CI host never reaches these calls.
 */

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { selection, result } = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'summary', 'inputs', 'passed.json'), 'utf8'),
);
const SUMMARY = '<!-- qa-core-prcheck:summary -->\n## PR Check: Passed\n';

function newDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  return dir;
}

const read = (file) => fs.readFileSync(file, 'utf8');

test('writes the summary file and the two JSON files beside it, with the select and run JSON', async (t) => {
  const dir = newDir(t);
  const written = await writeSummaryFiles({ summary: SUMMARY, summaryFile: path.join(dir, 's.md'), selection, result, env: {} });
  // The temp folder is outside the current folder, so only file names are shown.
  assert.deepEqual(written, { summaryFile: 's.md', stepSummary: false, artifacts: ['prcheck-selection.json', 'prcheck-results.json'] });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['prcheck-results.json', 'prcheck-selection.json', 's.md']);
  assert.equal(read(path.join(dir, 's.md')), SUMMARY);
  assert.equal(read(path.join(dir, 'prcheck-selection.json')), formatSelectionJson(selection));
  assert.equal(read(path.join(dir, 'prcheck-results.json')), formatRunJson(result));
});

test('the summary file is overwritten, not appended to', async (t) => {
  const dir = newDir(t);
  const file = path.join(dir, 'prcheck-summary.md');
  fs.writeFileSync(file, 'an older summary\n');
  await writeSummaryFiles({ summary: SUMMARY, summaryFile: file, selection: null, result: null, env: {} });
  assert.equal(read(file), SUMMARY);
});

test('with no selection and no result, only the summary file is written', async (t) => {
  const dir = newDir(t);
  const written = await writeSummaryFiles({ summary: SUMMARY, summaryFile: path.join(dir, 's.md'), selection: null, result: null, env: {} });
  assert.deepEqual(written, { summaryFile: 's.md', stepSummary: false, artifacts: [] });
  assert.deepEqual(fs.readdirSync(dir), ['s.md']);
});

test('GITHUB_STEP_SUMMARY set: the summary and a newline are appended after the existing text', async (t) => {
  const dir = newDir(t);
  const step = path.join(dir, 'step.md');
  fs.writeFileSync(step, 'text from an earlier command\n');
  const env = { GITHUB_STEP_SUMMARY: step };
  const written = await writeSummaryFiles({ summary: SUMMARY, summaryFile: path.join(dir, 's.md'), selection: null, result: null, env });
  assert.equal(written.stepSummary, true);
  assert.equal(read(step), `text from an earlier command\n${SUMMARY}\n`);
  await writeSummaryFiles({ summary: SUMMARY, summaryFile: path.join(dir, 's.md'), selection: null, result: null, env });
  assert.equal(read(step), `text from an earlier command\n${SUMMARY}\n${SUMMARY}\n`);
});

for (const [label, env] of [['unset', {}], ['empty', { GITHUB_STEP_SUMMARY: '' }]]) {
  test(`GITHUB_STEP_SUMMARY ${label}: nothing else is written`, async (t) => {
    const dir = newDir(t);
    const written = await writeSummaryFiles({ summary: SUMMARY, summaryFile: path.join(dir, 's.md'), selection: null, result: null, env });
    assert.equal(written.stepSummary, false);
    assert.deepEqual(fs.readdirSync(dir), ['s.md']);
  });
}

function assertPlainMessage(error, expected) {
  assert.ok(error instanceof ReportError, `expected ReportError, got ${error}`);
  assert.equal(error.message, expected);
  assert.ok(!error.message.includes(os.homedir()), error.message);
  assert.ok(!error.message.includes(fs.realpathSync(os.tmpdir())), error.message);
  assert.ok(!error.message.includes(os.tmpdir()), error.message);
  return true;
}

test('a summary file in a missing folder gives a ReportError with the file name only', async (t) => {
  const dir = newDir(t);
  await assert.rejects(
    writeSummaryFiles({ summary: SUMMARY, summaryFile: path.join(dir, 'missing', 's.md'), selection, result, env: {} }),
    (error) => assertPlainMessage(error, 'Cannot write s.md: ENOENT'),
  );
});

test('a GITHUB_STEP_SUMMARY in a missing folder gives a ReportError without the path', async (t) => {
  const dir = newDir(t);
  const env = { GITHUB_STEP_SUMMARY: path.join(dir, 'missing', 'step.md') };
  await assert.rejects(
    writeSummaryFiles({ summary: SUMMARY, summaryFile: path.join(dir, 's.md'), selection: null, result: null, env }),
    (error) => assertPlainMessage(error, 'Cannot append to $GITHUB_STEP_SUMMARY: ENOENT'),
  );
  // The summary file was written first.
  assert.equal(read(path.join(dir, 's.md')), SUMMARY);
});

test('a file inside the current folder is shown relative to it with forward slashes', async (t) => {
  const dir = newDir(t);
  fs.mkdirSync(path.join(dir, 'reports'));
  const before = process.cwd();
  process.chdir(dir);
  t.after(() => process.chdir(before));
  const written = await writeSummaryFiles({ summary: SUMMARY, summaryFile: 'reports/s.md', selection, result: null, env: {} });
  assert.deepEqual(written, { summaryFile: 'reports/s.md', stepSummary: false, artifacts: ['reports/prcheck-selection.json'] });
  await assert.rejects(
    writeSummaryFiles({ summary: SUMMARY, summaryFile: 'nope/s.md', selection: null, result: null, env: {} }),
    (error) => assertPlainMessage(error, 'Cannot write nope/s.md: ENOENT'),
  );
});
