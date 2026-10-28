import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanup, createTempRepo, gitEnv } from './helpers/git-repo.mjs';

/**
 * The check command, run as a process with its current folder in a temp folder, so no summary or JSON
 * file can land in this repo. No real Playwright test runs here: the cases use mode none, --dry-run,
 * or a made-up @playwright/test package. The demo inventory is read with --list, which opens no browser.
 */

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliJs = path.join(repoRoot, 'dist', 'cli.js');
const summaryDir = path.join(repoRoot, 'tests', 'fixtures', 'summary');
const pkgVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const lines = (...ls) => ls.map((l) => `${l}\n`).join('');
// Runs that start Playwright get a generous limit; none of them waits on a timer.
const LIVE = { timeout: 120_000 };
const diffFile = (name) => path.join(repoRoot, 'tests', 'fixtures', 'diffs', name);

/** A golden with the test version replaced by the real one, as the CLI prints it. */
const goldenOf = (name) => fs.readFileSync(path.join(summaryDir, `${name}.md`), 'utf8')
  .replace('qa-core-prcheck 0.0.0-test._', `qa-core-prcheck ${pkgVersion}._`);

// Taken out of every child env unless a case sets them: the CI and reporter keys, written here rather
// than taken from src, and GITHUB_STEP_SUMMARY, so a CI host's own job summary is never written to.
const HOST_KEYS = [
  'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL', 'BUILD_URL', 'PW_TEST_REPORTER',
  'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR', 'GITHUB_STEP_SUMMARY',
];
function withoutHostKeys(env) {
  const copy = { ...env };
  for (const key of HOST_KEYS) delete copy[key];
  return copy;
}

const USAGE = `qa-core-prcheck <command> [options]

Commands:
  diff            List the files changed between two git refs, or in a saved diff
  select          Pick the Playwright specs a change can affect (does not run them)
  run             Run the picked Playwright specs and report the results
  check           Pick, run and summarize: writes the Markdown summary for the PR
  comment         Post or update the sticky PR comment from a summary file

Options:
  -v, --version   Print the version
  -h, --help      Print this help

Run qa-core-prcheck <command> --help for the command options.
`;

const CHECK_USAGE = `qa-core-prcheck check --base <ref> [--head <ref>] [--root <dir>] [--summary-file <path>] [--json] [--dry-run]
qa-core-prcheck check --diff-file <path> [--root <dir>] [--summary-file <path>] [--json] [--dry-run]

Picks the Playwright specs a change can affect, runs them and writes one Markdown summary.

Options:
  --base <ref>           Compare against the merge base of this ref and the head
  --head <ref>           The head ref (default: HEAD)
  --diff-file <path>     Read a saved unified git diff instead of running git
  --root <dir>           The repository root (default: the current folder)
  --summary-file <path>  Where to write the summary (default: prcheck-summary.md)
  --json                 Print JSON instead of the Markdown summary
  --dry-run              Build the command and summary without running tests or writing files
  -h, --help             Print this help

Also appends the summary to $GITHUB_STEP_SUMMARY when it is set.
Exit codes: 0 all picked tests passed or nothing to run, 1 a picked test failed, 2 usage or tool error.
`;
const HELP_LINE = 'Run qa-core-prcheck check --help for usage.\n';

// Usage errors run from an empty temp folder where git cannot look upward,
// so even a bug could never send git to this repo.
const emptyDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
const emptyEnv = { ...withoutHostKeys(gitEnv()), GIT_CEILING_DIRECTORIES: path.dirname(emptyDir) };
after(() => cleanup(emptyDir));

const runCli = (args, { cwd, env = withoutHostKeys(process.env) }) => new Promise((resolve) => {
  // process.execPath, not 'node': the test must not depend on PATH.
  const child = spawn(process.execPath, [cliJs, ...args], { cwd, env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

function newDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  return dir;
}

const read = (file) => fs.readFileSync(file, 'utf8');

test('the top-level help lists the check command and no longer promises it', async () => {
  const r = await runCli(['--help'], { cwd: emptyDir, env: emptyEnv });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, USAGE);
  assert.equal(r.stderr, '');
});

for (const flag of ['--help', '-h']) {
  test(`check ${flag} prints the check help and exits 0`, async () => {
    const r = await runCli(['check', flag], { cwd: emptyDir, env: emptyEnv });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, CHECK_USAGE);
    assert.equal(r.stderr, '');
  });
}

const USAGE_ERRORS = [
  [['check'], 'Missing required option: --base <ref> or --diff-file <path>'],
  [['check', '--json'], 'Missing required option: --base <ref> or --diff-file <path>'],
  [['check', '--dry-run'], 'Missing required option: --base <ref> or --diff-file <path>'],
  [['check', '--summary-file', 's.md'], 'Missing required option: --base <ref> or --diff-file <path>'],
  [['check', '--nope'], 'Unknown argument: --nope'],
  [['check', '--summary-file=s.md'], 'Unknown argument: --summary-file=s.md'],
  [['check', '--diff-file', 'x.diff', 'extra'], 'Unknown argument: extra'],
  [['check', '--help', '--json'], 'Unknown argument: --json'],
  [['check', '--dry-run', '--help'], 'Unknown argument: --help'],
  [['check', '--base'], 'Missing value for --base'],
  [['check', '--diff-file'], 'Missing value for --diff-file'],
  [['check', '--root'], 'Missing value for --root'],
  [['check', '--summary-file'], 'Missing value for --summary-file'],
  [['check', '--summary-file', '--json', '--diff-file', 'x.diff'], 'Missing value for --summary-file'],
  [['check', '--base', 'main', '--head'], 'Missing value for --head'],
  [['check', '--summary-file', 'a.md', '--summary-file', 'b.md', '--diff-file', 'x.diff'], 'Duplicate argument: --summary-file'],
  [['check', '--root', 'a', '--root', 'b'], 'Duplicate argument: --root'],
  [['check', '--json', '--json', '--base', 'main'], 'Duplicate argument: --json'],
  [['check', '--dry-run', '--dry-run', '--base', 'main'], 'Duplicate argument: --dry-run'],
  [['check', '--base', 'main', '--diff-file', 'x.diff'], 'Use either --base or --diff-file, not both'],
  [['check', '--diff-file', 'x.diff', '--head', 'main'], '--head can only be used with --base'],
];

for (const [args, message] of USAGE_ERRORS) {
  test(`${args.join(' ')}: exits 2 with "${message}", an empty stdout and no file written`, async () => {
    const r = await runCli(args, { cwd: emptyDir, env: emptyEnv });
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `${message}\n${HELP_LINE}`);
    assert.deepEqual(fs.readdirSync(emptyDir), []);
  });
}

test('delete.diff: prints the no-tests-needed summary, writes it and the two JSON files, exits 0', LIVE, async (t) => {
  const cwd = newDir(t);
  const r = await runCli(['check', '--diff-file', diffFile('delete.diff'), '--root', repoRoot], { cwd });
  assert.equal(r.stderr, '');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, goldenOf('no-tests-needed'));
  assert.deepEqual(fs.readdirSync(cwd).sort(), ['prcheck-results.json', 'prcheck-selection.json', 'prcheck-summary.md']);
  assert.equal(read(path.join(cwd, 'prcheck-summary.md')), r.stdout);
  assert.equal(JSON.parse(read(path.join(cwd, 'prcheck-selection.json'))).mode, 'none');
  assert.equal(JSON.parse(read(path.join(cwd, 'prcheck-results.json'))).verdict, 'nothing-to-run');
});

test('delete.diff with GITHUB_STEP_SUMMARY set: the summary is appended there too', LIVE, async (t) => {
  const cwd = newDir(t);
  const step = path.join(cwd, 'step.md');
  fs.writeFileSync(step, 'text from an earlier command\n');
  const env = { ...withoutHostKeys(process.env), GITHUB_STEP_SUMMARY: step };
  const r = await runCli(['check', '--diff-file', diffFile('delete.diff'), '--root', repoRoot, '--summary-file', 's3.md'], { cwd, env });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, goldenOf('no-tests-needed'));
  assert.equal(read(path.join(cwd, 's3.md')), r.stdout);
  assert.equal(read(step), `text from an earlier command\n${r.stdout}\n`);
});

test('modify.diff --dry-run: prints the not-run summary and writes no file, even with GITHUB_STEP_SUMMARY set', LIVE, async (t) => {
  const cwd = newDir(t);
  const env = { ...withoutHostKeys(process.env), GITHUB_STEP_SUMMARY: path.join(cwd, 'step.md') };
  const r = await runCli(['check', '--diff-file', diffFile('modify.diff'), '--root', repoRoot, '--dry-run'], { cwd, env });
  assert.equal(r.stderr, '');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, goldenOf('not-run'));
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test('--dry-run --json: keys in the documented order, file null and stepSummary false', LIVE, async (t) => {
  const cwd = newDir(t);
  const r = await runCli(['check', '--diff-file', diffFile('modify.diff'), '--root', repoRoot, '--dry-run', '--json'], { cwd });
  assert.equal(r.stderr, '');
  assert.equal(r.status, 0);
  assert.ok(r.stdout.endsWith('}\n'));
  const json = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(json), ['schemaVersion', 'selection', 'result', 'summary', 'exitCode']);
  assert.deepEqual(Object.keys(json.summary), ['verdict', 'fullSuite', 'truncated', 'omitted', 'bytes', 'file', 'stepSummary']);
  assert.deepEqual(json.summary, {
    verdict: 'not-run', fullSuite: false, truncated: false, omitted: 0,
    bytes: Buffer.byteLength(goldenOf('not-run')), file: null, stepSummary: false,
  });
  assert.deepEqual([json.schemaVersion, json.selection.mode, json.result.verdict, json.exitCode], [1, 'subset', 'not-run', 0]);
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test('--json without --dry-run names the summary file relative to the current folder', LIVE, async (t) => {
  const cwd = newDir(t);
  const r = await runCli(['check', '--diff-file', diffFile('delete.diff'), '--root', repoRoot, '--json'], { cwd });
  assert.equal(r.status, 0);
  const json = JSON.parse(r.stdout);
  assert.deepEqual([json.summary.file, json.summary.stepSummary, json.exitCode], ['prcheck-summary.md', false, 0]);
  assert.equal(read(path.join(cwd, 'prcheck-summary.md')), goldenOf('no-tests-needed'));
});

test('a summary file in a missing folder: the summary is still printed, the error goes to stderr, exit 2', LIVE, async (t) => {
  const cwd = newDir(t);
  const r = await runCli(['check', '--diff-file', diffFile('delete.diff'), '--root', repoRoot, '--summary-file', 'missing/s.md'], { cwd });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, goldenOf('no-tests-needed'));
  assert.equal(r.stderr, 'Cannot write missing/s.md: ENOENT\n');
  assert.deepEqual(fs.readdirSync(cwd), []);
});

test('check --base nope in a temp git repo: exit 2, empty stdout, the message on stderr and the pre-run-error summary', async (t) => {
  const repo = createTempRepo();
  t.after(() => cleanup(repo.dir));
  const r = await runCli(['check', '--base', 'nope'], { cwd: repo.dir, env: withoutHostKeys(repo.env) });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `Unknown ref: nope. Fetch it first, for example git fetch origin <branch>\n${HELP_LINE}`);
  assert.deepEqual(fs.readdirSync(repo.dir).filter((name) => name !== '.git'), ['prcheck-summary.md']);
  assert.equal(read(path.join(repo.dir, 'prcheck-summary.md')), goldenOf('pre-run-error'));
});

test('check --base nope --dry-run writes no summary', async (t) => {
  const repo = createTempRepo();
  t.after(() => cleanup(repo.dir));
  const r = await runCli(['check', '--base', 'nope', '--dry-run'], { cwd: repo.dir, env: withoutHostKeys(repo.env) });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.deepEqual(fs.readdirSync(repo.dir), ['.git']);
});

test('a runner error exits 2, prints the summary on stdout and the first error on stderr', LIVE, async (t) => {
  // A made-up @playwright/test: --list prints one cart spec; a test run fails before writing a report.
  const dir = newDir(t);
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write('node_modules/@playwright/test/package.json', JSON.stringify({ name: '@playwright/test', version: '0.0.0', exports: { './cli': './cli.js' } }));
  write('node_modules/@playwright/test/cli.js', lines(
    "const path = require('node:path');",
    "if (process.argv.includes('--list')) {",
    "  const spec = { title: 'adds a backpack', tags: ['cart'], tests: [{ projectName: 'chromium' }], file: 'cart/cart.spec.ts', line: 3 };",
    "  const rootDir = path.join(process.cwd(), 'demo', 'saucedemo', 'tests');",
    "  process.stdout.write(JSON.stringify({ config: { rootDir }, suites: [{ title: 'cart/cart.spec.ts', specs: [spec] }], errors: [] }));",
    '} else {',
    "  process.stderr.write('Error: chromium is not installed\\n');",
    '  process.exitCode = 1;',
    '}',
  ));
  write('demo/saucedemo/playwright.config.ts', lines('export default {};'));
  write('demo/saucedemo/tests/cart/cart.spec.ts', lines("import { test } from '@playwright/test';"));

  const cwd = newDir(t);
  const r = await runCli(['check', '--diff-file', diffFile('mixed.diff'), '--root', dir], { cwd });
  const error = 'Playwright wrote no JSON report (exit code 1): Error: chromium is not installed';
  assert.equal(r.status, 2);
  assert.equal(r.stderr, `${error}\n`);
  // The full suite reasons depend on the mixed.diff rules and are asserted in the select tests.
  assert.ok(r.stdout.startsWith(lines(
    '<!-- qa-core-prcheck:summary -->',
    '## PR Check: Error (Full Suite Run)',
    '',
    'The check could not finish, so the test result is unknown. See Errors below.',
    '',
    '### Why The Full Suite Was Picked',
  )));
  assert.ok(r.stdout.includes(lines(
    '### Picked Specs',
    '| Spec | Tests | Result | Reasons |',
    '| --- | ---: | --- | --- |',
    // mixed.diff changes the cart spec too, so rule 3 adds its own reason before the full suite one.
    '| `demo/saucedemo/tests/cart/cart.spec.ts` | 1 | not run | Spec changed: demo/saucedemo/tests/cart/cart.spec.ts<br>Part of the full suite run |',
    '',
    '### Errors',
    `- ${error}`,
    '',
    '### Warnings',
    '- No tests ran for the selected specs',
    '',
    '---',
    `_Advisory check, exit code 2. Mode full, 1 of 1 specs picked. qa-core-prcheck ${pkgVersion}._`,
  )));
  assert.equal(read(path.join(cwd, 'prcheck-summary.md')), r.stdout);
});
