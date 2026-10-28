import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanup, createTempRepo, gitEnv } from './helpers/git-repo.mjs';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliJs = path.join(repoRoot, 'dist', 'cli.js');
const lines = (...ls) => ls.map((l) => `${l}\n`).join('');

const DIFF_USAGE = `qa-core-prcheck diff --base <ref> [--head <ref>] [--json]
qa-core-prcheck diff --diff-file <path> [--json]

Options:
  --base <ref>        Compare against the merge base of this ref and the head
  --head <ref>        The head ref (default: HEAD)
  --diff-file <path>  Read a saved unified git diff instead of running git
  --json              Print JSON instead of text
  -h, --help          Print this help

Exit codes: 0 ok, 2 usage or tool error. Code 1 is reserved.
`;
const HELP_LINE = 'Run qa-core-prcheck diff --help for usage.\n';

// Usage errors run from an empty temp folder where git cannot look upward,
// so even a bug could never send git to this repo.
const emptyDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
const emptyEnv = { ...gitEnv(), GIT_CEILING_DIRECTORIES: path.dirname(emptyDir) };
after(() => cleanup(emptyDir));

const runCli = (args, { cwd = repoRoot, env = process.env } = {}) => new Promise((resolve) => {
  // process.execPath, not 'node': the test must not depend on PATH.
  const child = spawn(process.execPath, [cliJs, ...args], { cwd, env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

test('the top-level help lists the diff command', async () => {
  // The exact top-level text is asserted in tests/cli.test.mjs.
  const r = await runCli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\n {2}diff {12}List the files changed between two git refs, or in a saved diff\n/);
  assert.match(r.stdout, /Run qa-core-prcheck <command> --help for the command options\./);
});

for (const flag of ['--help', '-h']) {
  test(`diff ${flag} prints the diff help and exits 0`, async () => {
    const r = await runCli(['diff', flag], { cwd: emptyDir, env: emptyEnv });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, DIFF_USAGE);
    assert.equal(r.stderr, '');
  });
}

const USAGE_ERRORS = [
  [['diff'], 'Missing required option: --base <ref> or --diff-file <path>'],
  [['diff', '--json'], 'Missing required option: --base <ref> or --diff-file <path>'],
  [['diff', '--nope'], 'Unknown argument: --nope'],
  [['diff', '--base=main'], 'Unknown argument: --base=main'],
  [['diff', '--base', 'main', 'extra'], 'Unknown argument: extra'],
  [['diff', '--help', '--json'], 'Unknown argument: --json'],
  [['diff', '--json', '--help'], 'Unknown argument: --help'],
  [['diff', '--base'], 'Missing value for --base'],
  [['diff', '--base', '--json'], 'Missing value for --base'],
  [['diff', '--diff-file'], 'Missing value for --diff-file'],
  [['diff', '--base', 'main', '--head'], 'Missing value for --head'],
  [['diff', '--base', 'main', '--base', 'dev'], 'Duplicate argument: --base'],
  [['diff', '--json', '--json', '--base', 'main'], 'Duplicate argument: --json'],
  [['diff', '--base', 'main', '--diff-file', 'x.diff'], 'Use either --base or --diff-file, not both'],
  [['diff', '--diff-file', 'x.diff', '--head', 'main'], '--head can only be used with --base'],
  [['diff', '--head', 'main'], '--head can only be used with --base'],
];

for (const [args, message] of USAGE_ERRORS) {
  test(`${args.join(' ')}: exits 2 with "${message}" and an empty stdout`, async () => {
    const r = await runCli(args, { cwd: emptyDir, env: emptyEnv });
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `${message}\n${HELP_LINE}`);
  });
}

test('a valid flag followed by diff is still an unknown argument at the top level', async () => {
  const r = await runCli(['--help', 'diff']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'Unknown argument: diff\nRun qa-core-prcheck --help for usage.\n');
});

test('diff --diff-file mixed.diff prints the expected text', async () => {
  // Written by hand from tests/fixtures/diffs/mixed.diff: ten modified files.
  const expected = lines(
    'Changed files: 10',
    'modified  .github/workflows/ci.yml  +1 -0  ci-workflow',
    'modified  .nvmrc  +1 -1  other',
    'modified  README.md  +1 -1  docs',
    'modified  demo/saucedemo/fixtures/users.ts  +1 -0  test-data',
    'modified  demo/saucedemo/pages/cart-page.ts  +1 -1  test-support',
    'modified  demo/saucedemo/playwright.config.ts  +1 -1  playwright-config',
    'modified  demo/saucedemo/tests/cart/cart.spec.ts  +1 -1  spec',
    'modified  package-lock.json  +1 -1  lockfile',
    'modified  package.json  +1 -1  package-manifest',
    'modified  src/cli.ts  +1 -1  app-source',
  );
  const r = await runCli(['diff', '--diff-file', 'tests/fixtures/diffs/mixed.diff']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, expected);
});

test('diff --diff-file mixed.diff --json prints the documented JSON shape', async () => {
  const r = await runCli(['diff', '--diff-file', 'tests/fixtures/diffs/mixed.diff', '--json']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.ok(r.stdout.endsWith('}\n'));
  const json = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(json), ['schemaVersion', 'source', 'files']);
  assert.equal(json.schemaVersion, 1);
  assert.deepEqual(json.source, { type: 'file', path: 'tests/fixtures/diffs/mixed.diff' });
  assert.deepEqual(json.files.map((f) => [f.path, f.status, f.fileClass]), [
    ['.github/workflows/ci.yml', 'modified', 'ci-workflow'],
    ['.nvmrc', 'modified', 'other'],
    ['README.md', 'modified', 'docs'],
    ['demo/saucedemo/fixtures/users.ts', 'modified', 'test-data'],
    ['demo/saucedemo/pages/cart-page.ts', 'modified', 'test-support'],
    ['demo/saucedemo/playwright.config.ts', 'modified', 'playwright-config'],
    ['demo/saucedemo/tests/cart/cart.spec.ts', 'modified', 'spec'],
    ['package-lock.json', 'modified', 'lockfile'],
    ['package.json', 'modified', 'package-manifest'],
    ['src/cli.ts', 'modified', 'app-source'],
  ]);
  assert.deepEqual(Object.keys(json.files[0]), [
    'path', 'oldPath', 'status', 'similarity', 'binary', 'additions', 'deletions', 'ranges', 'fileClass',
  ]);
  assert.deepEqual(json.files[0], {
    path: '.github/workflows/ci.yml', oldPath: null, status: 'modified', similarity: null,
    binary: false, additions: 1, deletions: 0, ranges: [{ start: 8, end: 8 }], fileClass: 'ci-workflow',
  });
});

test('diff --diff-file empty.diff prints Changed files: 0', async () => {
  const text = await runCli(['diff', '--diff-file', 'tests/fixtures/diffs/empty.diff']);
  assert.equal(text.status, 0);
  assert.equal(text.stdout, 'Changed files: 0\n');
  const json = await runCli(['diff', '--diff-file', 'tests/fixtures/diffs/empty.diff', '--json']);
  assert.equal(json.status, 0);
  assert.deepEqual(JSON.parse(json.stdout).files, []);
});

test('diff --diff-file with a missing file exits 2 with Cannot read diff file', async () => {
  const r = await runCli(['diff', '--diff-file', 'tests/fixtures/diffs/missing.diff']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `Cannot read diff file: tests/fixtures/diffs/missing.diff\n${HELP_LINE}`);
});

test('diff --diff-file with a file that is not a diff exits 2', async () => {
  const r = await runCli(['diff', '--diff-file', 'README.md']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /not a git unified diff/);
  assert.ok(r.stderr.endsWith(HELP_LINE));
});

test('end to end with git: diff --base main --head feature in a temp repo', async (t) => {
  const repo = createTempRepo();
  t.after(() => cleanup(repo.dir));
  repo.write('README.md', lines('# SauceDemo Checks'));
  repo.write('src/cli.ts', lines("const USAGE = 'saucedemo-checks <option>';"));
  repo.write('demo/saucedemo/pages/cart-page.ts', lines(
    "import { type Page } from '@playwright/test';",
    '',
    'export class CartPage {',
    '  constructor(readonly page: Page) {}',
    '}',
  ));
  const forkSha = repo.commitAll('base');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write('src/cli.ts', lines("const USAGE = 'saucedemo-checks <command> [options]';"));
  repo.git('mv', 'demo/saucedemo/pages/cart-page.ts', 'demo/saucedemo/pages/basket-page.ts');
  repo.write('docs/release notes.md', lines('# Release Notes', 'Added a basket page.'));
  const headSha = repo.commitAll('feature');
  // A later commit on main must not show up: the diff starts at the merge base.
  repo.git('checkout', '-q', 'main');
  repo.write('README.md', lines('# SauceDemo Checks', 'Main moved on.'));
  const mainSha = repo.commitAll('main moves on');

  const options = { cwd: repo.dir, env: repo.env };
  const r = await runCli(['diff', '--base', 'main', '--head', 'feature', '--json'], options);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  const json = JSON.parse(r.stdout);
  assert.deepEqual(json.source, {
    type: 'git', base: 'main', head: 'feature', baseSha: mainSha, headSha, mergeBaseSha: forkSha,
  });
  assert.deepEqual(json.files.map((f) => [f.path, f.oldPath, f.status]), [
    ['demo/saucedemo/pages/basket-page.ts', 'demo/saucedemo/pages/cart-page.ts', 'renamed'],
    ['docs/release notes.md', null, 'added'],
    ['src/cli.ts', null, 'modified'],
  ]);

  const text = await runCli(['diff', '--base', 'main', '--head', 'feature'], options);
  assert.equal(text.status, 0);
  assert.equal(text.stdout, lines(
    `Merge base: ${forkSha}`,
    'Changed files: 3',
    'renamed   demo/saucedemo/pages/cart-page.ts -> demo/saucedemo/pages/basket-page.ts  +0 -0  test-support',
    'added     docs/release notes.md  +2 -0  docs',
    'modified  src/cli.ts  +1 -1  app-source',
  ));

  const unknown = await runCli(['diff', '--base', 'nope'], options);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, '');
  assert.equal(unknown.stderr, `Unknown ref: nope. Fetch it first, for example git fetch origin <branch>\n${HELP_LINE}`);
});
