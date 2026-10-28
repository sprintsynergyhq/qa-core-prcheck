import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanup, createTempRepo, gitEnv } from './helpers/git-repo.mjs';

/**
 * The select command, run as a process. Expected output is written by hand from the demo import graph:
 * every demo spec imports fixtures/users.ts, login-page.ts and inventory-page.ts directly; the cart and
 * checkout specs import cart-page.ts directly; login-page.ts imports fixtures/users.ts; the Playwright
 * config imports only @playwright/test. The demo has four specs with two tests each.
 */

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliJs = path.join(repoRoot, 'dist', 'cli.js');
const lines = (...ls) => ls.map((l) => `${l}\n`).join('');
// Runs that start Playwright get a generous limit; none of them waits on a timer.
const LIVE = { timeout: 120_000 };

const SELECT_USAGE = `qa-core-prcheck select --base <ref> [--head <ref>] [--root <dir>] [--json]
qa-core-prcheck select --diff-file <path> [--root <dir>] [--json]

Picks the Playwright specs a change can affect. It does not run any test.

Options:
  --base <ref>        Compare against the merge base of this ref and the head
  --head <ref>        The head ref (default: HEAD)
  --diff-file <path>  Read a saved unified git diff instead of running git
  --root <dir>        The repository root (default: the current folder)
  --json              Print JSON instead of text
  -h, --help          Print this help

Reads qa-core-prcheck.config.json from the root when it exists.
Exit codes: 0 ok, 2 usage or tool error. Code 1 is reserved.
`;
const HELP_LINE = 'Run qa-core-prcheck select --help for usage.\n';

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

const d = (file) => `demo/saucedemo/${file}`;
const CART_SPEC = d('tests/cart/cart.spec.ts');
const CHECKOUT_SPEC = d('tests/checkout/checkout.spec.ts');
const INVENTORY_SPEC = d('tests/inventory/inventory.spec.ts');
const LOGIN_SPEC = d('tests/login/login.spec.ts');
const CART_PAGE = d('pages/cart-page.ts');
const USERS = d('fixtures/users.ts');

test('the top-level help lists the select command', async () => {
  // The exact top-level text is asserted in tests/cli.test.mjs.
  const r = await runCli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\n {2}select {10}Pick the Playwright specs a change can affect \(does not run them\)\n/);
});

for (const flag of ['--help', '-h']) {
  test(`select ${flag} prints the select help and exits 0`, async () => {
    const r = await runCli(['select', flag], { cwd: emptyDir, env: emptyEnv });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, SELECT_USAGE);
    assert.equal(r.stderr, '');
  });
}

const USAGE_ERRORS = [
  [['select'], 'Missing required option: --base <ref> or --diff-file <path>'],
  [['select', '--json'], 'Missing required option: --base <ref> or --diff-file <path>'],
  [['select', '--root', '.'], 'Missing required option: --base <ref> or --diff-file <path>'],
  [['select', '--nope'], 'Unknown argument: --nope'],
  [['select', '--root=.'], 'Unknown argument: --root=.'],
  [['select', '--diff-file', 'x.diff', 'extra'], 'Unknown argument: extra'],
  [['select', '--help', '--json'], 'Unknown argument: --json'],
  [['select', '--json', '--help'], 'Unknown argument: --help'],
  [['select', '--base'], 'Missing value for --base'],
  [['select', '--diff-file'], 'Missing value for --diff-file'],
  [['select', '--root'], 'Missing value for --root'],
  [['select', '--root', '--json'], 'Missing value for --root'],
  [['select', '--base', 'main', '--head'], 'Missing value for --head'],
  [['select', '--root', 'a', '--root', 'b'], 'Duplicate argument: --root'],
  [['select', '--json', '--json', '--base', 'main'], 'Duplicate argument: --json'],
  [['select', '--base', 'main', '--diff-file', 'x.diff'], 'Use either --base or --diff-file, not both'],
  [['select', '--diff-file', 'x.diff', '--head', 'main'], '--head can only be used with --base'],
  [['select', '--head', 'main'], '--head can only be used with --base'],
];

for (const [args, message] of USAGE_ERRORS) {
  test(`${args.join(' ')}: exits 2 with "${message}" and an empty stdout`, async () => {
    const r = await runCli(args, { cwd: emptyDir, env: emptyEnv });
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `${message}\n${HELP_LINE}`);
  });
}

test('select --diff-file modify.diff prints the cart page specs as text', LIVE, async () => {
  const r = await runCli(['select', '--diff-file', 'tests/fixtures/diffs/modify.diff']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, lines(
    'Mode: subset',
    'Selected specs: 2 of 4',
    `  ${CART_SPEC}`,
    `    - ${CART_PAGE} is imported by ${CART_SPEC}`,
    `  ${CHECKOUT_SPEC}`,
    `    - ${CART_PAGE} is imported by ${CHECKOUT_SPEC}`,
    'Changed files: 1',
    `specs    ${CART_PAGE}  Used by spec files: 2`,
  ));
});

test('select --diff-file modify.diff --json prints the documented JSON shape', LIVE, async () => {
  const r = await runCli(['select', '--diff-file', 'tests/fixtures/diffs/modify.diff', '--json']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.ok(r.stdout.endsWith('}\n'));
  const json = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(json), [
    'schemaVersion', 'source', 'mode', 'playwrightDir', 'totalSpecs', 'totalTests',
    'selected', 'fullSuiteReasons', 'decisions', 'warnings',
  ]);
  assert.deepEqual(Object.keys(json.selected[0]), ['file', 'testCount', 'tags', 'reasons']);
  assert.deepEqual(Object.keys(json.decisions[0]), ['path', 'fileClass', 'status', 'outcome', 'reason', 'specs']);
  assert.deepEqual(json, {
    schemaVersion: 1,
    source: { type: 'file', path: 'tests/fixtures/diffs/modify.diff' },
    mode: 'subset',
    playwrightDir: 'demo/saucedemo',
    totalSpecs: 4,
    totalTests: 8,
    selected: [
      { file: CART_SPEC, testCount: 2, tags: ['@cart'], reasons: [`${CART_PAGE} is imported by ${CART_SPEC}`] },
      { file: CHECKOUT_SPEC, testCount: 2, tags: ['@checkout'], reasons: [`${CART_PAGE} is imported by ${CHECKOUT_SPEC}`] },
    ],
    fullSuiteReasons: [],
    decisions: [{
      path: CART_PAGE, fileClass: 'test-support', status: 'modified', outcome: 'specs',
      reason: 'Used by spec files: 2', specs: [CART_SPEC, CHECKOUT_SPEC],
    }],
    warnings: [],
  });
});

test('select --diff-file delete.diff: a docs-only change gives mode none', LIVE, async () => {
  const r = await runCli(['select', '--diff-file', 'tests/fixtures/diffs/delete.diff']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, lines(
    'Mode: none',
    'Selected specs: 0 of 4',
    'Changed files: 1',
    'none     docs/old-notes.md  Documentation only: docs/old-notes.md',
  ));
});

test('select --diff-file add.diff: a new page no spec imports gives mode none', LIVE, async () => {
  const r = await runCli(['select', '--diff-file', 'tests/fixtures/diffs/add.diff']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, lines(
    'Mode: none',
    'Selected specs: 0 of 4',
    'Changed files: 1',
    'none     demo/saucedemo/pages/wishlist-page.ts  No spec imports demo/saucedemo/pages/wishlist-page.ts',
  ));
});

const FULL_RUN = 'Part of the full suite run';
const MIXED_TEXT = lines(
  'Mode: full',
  'Selected specs: 4 of 4',
  `  ${CART_SPEC}`,
  `    - Spec changed: ${CART_SPEC}`,
  `    - ${USERS} is imported by ${CART_SPEC}`,
  `    - ${CART_PAGE} is imported by ${CART_SPEC}`,
  `    - ${FULL_RUN}`,
  `  ${CHECKOUT_SPEC}`,
  `    - ${USERS} is imported by ${CHECKOUT_SPEC}`,
  `    - ${CART_PAGE} is imported by ${CHECKOUT_SPEC}`,
  `    - ${FULL_RUN}`,
  `  ${INVENTORY_SPEC}`,
  `    - ${USERS} is imported by ${INVENTORY_SPEC}`,
  `    - ${FULL_RUN}`,
  `  ${LOGIN_SPEC}`,
  `    - ${USERS} is imported by ${LOGIN_SPEC}`,
  `    - ${FULL_RUN}`,
  'Full suite reasons:',
  '  - CI workflow changed: .github/workflows/ci.yml',
  '  - Lockfile changed: package-lock.json',
  '  - No rule maps .nvmrc (other) to a test',
  '  - No rule maps src/cli.ts (app-source) to a test',
  '  - Package manifest changed: package.json',
  `  - Playwright config changed: ${d('playwright.config.ts')}`,
  'Changed files: 10',
  'full     .github/workflows/ci.yml  CI workflow changed: .github/workflows/ci.yml',
  'full     .nvmrc  No rule maps .nvmrc (other) to a test',
  'none     README.md  Documentation only: README.md',
  `specs    ${USERS}  Used by spec files: 4`,
  `specs    ${CART_PAGE}  Used by spec files: 2`,
  `full     ${d('playwright.config.ts')}  Playwright config changed: ${d('playwright.config.ts')}`,
  `specs    ${CART_SPEC}  Spec changed: ${CART_SPEC}`,
  'full     package-lock.json  Lockfile changed: package-lock.json',
  'full     package.json  Package manifest changed: package.json',
  'full     src/cli.ts  No rule maps src/cli.ts (app-source) to a test',
);

test('select --diff-file mixed.diff gives mode full and lists every demo spec', LIVE, async () => {
  const r = await runCli(['select', '--diff-file', 'tests/fixtures/diffs/mixed.diff']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, MIXED_TEXT);

  const json = JSON.parse((await runCli(['select', '--diff-file', 'tests/fixtures/diffs/mixed.diff', '--json'])).stdout);
  assert.equal(json.mode, 'full');
  assert.deepEqual(json.selected.map((s) => s.file), [CART_SPEC, CHECKOUT_SPEC, INVENTORY_SPEC, LOGIN_SPEC]);
  assert.deepEqual(json.selected.map((s) => s.reasons.at(-1)), [FULL_RUN, FULL_RUN, FULL_RUN, FULL_RUN]);
});

test('select --diff-file empty.diff gives mode none and Changed files: 0', LIVE, async () => {
  const r = await runCli(['select', '--diff-file', 'tests/fixtures/diffs/empty.diff']);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, lines('Mode: none', 'Selected specs: 0 of 4', 'Changed files: 0'));
  const json = JSON.parse((await runCli(['select', '--diff-file', 'tests/fixtures/diffs/empty.diff', '--json'])).stdout);
  assert.equal(json.mode, 'none');
  assert.deepEqual(json.selected, []);
  assert.deepEqual(json.decisions, []);
});

test('two runs of the same command give byte identical stdout', LIVE, async () => {
  for (const args of [
    ['select', '--diff-file', 'tests/fixtures/diffs/mixed.diff'],
    ['select', '--diff-file', 'tests/fixtures/diffs/mixed.diff', '--json'],
  ]) {
    const first = await runCli(args);
    const second = await runCli(args);
    assert.equal(first.status, 0);
    assert.equal(first.stdout, second.stdout);
  }
});

test('select --diff-file with a missing file exits 2 with Cannot read diff file', async () => {
  const r = await runCli(['select', '--diff-file', 'tests/fixtures/diffs/missing.diff']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `Cannot read diff file: tests/fixtures/diffs/missing.diff\n${HELP_LINE}`);
});

test('select --diff-file with a file that is not a diff exits 2', async () => {
  const r = await runCli(['select', '--diff-file', 'README.md']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /not a git unified diff/);
  assert.ok(r.stderr.endsWith(HELP_LINE));
});

test('select --root with a missing folder exits 2 with Root folder not found', async () => {
  const missing = path.join(emptyDir, 'missing');
  const r = await runCli(['select', '--diff-file', 'tests/fixtures/diffs/modify.diff', '--root', missing]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `Root folder not found: ${missing}\n${HELP_LINE}`);
});

test('select --root with a bad config file exits 2 with a message that names the key', async (t) => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  fs.writeFileSync(path.join(dir, 'qa-core-prcheck.config.json'), JSON.stringify({ areas: ['@cart'] }));
  const r = await runCli(['select', '--diff-file', 'tests/fixtures/diffs/modify.diff', '--root', dir]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `qa-core-prcheck.config.json: "areas" must be an object that maps a glob to a list of tags\n${HELP_LINE}`);
});

test('select --root with no demo folder exits 2 with Playwright folder not found', async (t) => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  const r = await runCli(['select', '--diff-file', 'tests/fixtures/diffs/modify.diff', '--root', dir]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `Playwright folder not found: demo/saucedemo\n${HELP_LINE}`);
});

test('end to end with git: select --base main --head feature in a temp repo', LIVE, async (t) => {
  const repo = createTempRepo();
  t.after(() => cleanup(repo.dir));
  repo.write('.gitignore', lines('node_modules'));
  // A link to this repo's installed packages, so Playwright resolves; it is ignored, so never committed.
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(repo.dir, 'node_modules'), 'dir');
  repo.write('qa-core-prcheck.config.json', JSON.stringify({ playwrightDir: 'demo/shop' }));
  repo.write('demo/shop/playwright.config.ts', lines(
    "import { defineConfig } from '@playwright/test';",
    '',
    "export default defineConfig({ testDir: './tests' });",
  ));
  repo.write('demo/shop/pages/cart-page.ts', lines(
    "import type { Page } from '@playwright/test';",
    '',
    'export class CartPage {',
    '  constructor(readonly page: Page) {}',
    "  async open() { await this.page.goto('/cart.html'); }",
    '}',
  ));
  repo.write('demo/shop/pages/login-page.ts', lines(
    "import type { Page } from '@playwright/test';",
    '',
    'export class LoginPage {',
    '  constructor(readonly page: Page) {}',
    "  async open() { await this.page.goto('/'); }",
    '}',
  ));
  repo.write('demo/shop/tests/cart.spec.ts', lines(
    "import { test } from '@playwright/test';",
    "import { CartPage } from '../pages/cart-page';",
    '',
    "test.describe('cart', { tag: '@cart' }, () => {",
    "  test('opens the cart', async ({ page }) => {",
    '    await new CartPage(page).open();',
    '  });',
    '});',
  ));
  repo.write('demo/shop/tests/login.spec.ts', lines(
    "import { test } from '@playwright/test';",
    "import { LoginPage } from '../pages/login-page';",
    '',
    "test.describe('login', { tag: '@login' }, () => {",
    "  test('opens the login page', async ({ page }) => {",
    '    await new LoginPage(page).open();',
    '  });',
    '});',
  ));
  const forkSha = repo.commitAll('base');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write('demo/shop/pages/cart-page.ts', lines(
    "import type { Page } from '@playwright/test';",
    '',
    'export class CartPage {',
    '  constructor(readonly page: Page) {}',
    "  async open() { await this.page.goto('/cart.html', { waitUntil: 'domcontentloaded' }); }",
    '}',
  ));
  repo.write('docs/notes.md', lines('# Notes', 'The cart page waits for the DOM.'));
  const headSha = repo.commitAll('feature');

  const options = { cwd: repo.dir, env: repo.env };
  const r = await runCli(['select', '--base', 'main', '--head', 'feature', '--json'], options);
  assert.equal(r.stderr, '');
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), {
    schemaVersion: 1,
    source: { type: 'git', base: 'main', head: 'feature', baseSha: forkSha, headSha, mergeBaseSha: forkSha },
    mode: 'subset',
    playwrightDir: 'demo/shop',
    totalSpecs: 2,
    totalTests: 2,
    selected: [{
      file: 'demo/shop/tests/cart.spec.ts', testCount: 1, tags: ['@cart'],
      reasons: ['demo/shop/pages/cart-page.ts is imported by demo/shop/tests/cart.spec.ts'],
    }],
    fullSuiteReasons: [],
    decisions: [
      {
        path: 'demo/shop/pages/cart-page.ts', fileClass: 'test-support', status: 'modified', outcome: 'specs',
        reason: 'Used by spec files: 1', specs: ['demo/shop/tests/cart.spec.ts'],
      },
      {
        path: 'docs/notes.md', fileClass: 'docs', status: 'added', outcome: 'none',
        reason: 'Documentation only: docs/notes.md', specs: [],
      },
    ],
    warnings: [],
  });

  const unknown = await runCli(['select', '--base', 'nope'], options);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, '');
  assert.equal(unknown.stderr, `Unknown ref: nope. Fetch it first, for example git fetch origin <branch>\n${HELP_LINE}`);
});
