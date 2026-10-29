import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InventoryError, parsePlaywrightList, readInventory } from '../dist/inventory/index.js';
import { cleanup } from './helpers/git-repo.mjs';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureText = fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'inventory', 'demo-list.json'), 'utf8');
const lines = (...ls) => ls.map((l) => `${l}\n`).join('');

// Written by hand from reading demo/saucedemo/tests/*/*.spec.ts: the describe title, each test title,
// the line of each test() call, the describe tag, and the one project in playwright.config.ts.
const chromium = ['chromium'];
const DEMO_INVENTORY = {
  schemaVersion: 1,
  playwrightDir: 'demo/saucedemo',
  specs: [
    {
      file: 'demo/saucedemo/tests/cart/cart.spec.ts',
      tests: [
        { title: 'cart > adds a product to the cart', line: 12, tags: ['@cart'], projects: chromium },
        { title: 'cart > removes a product from the cart', line: 24, tags: ['@cart'], projects: chromium },
      ],
    },
    {
      file: 'demo/saucedemo/tests/checkout/checkout.spec.ts',
      tests: [
        { title: 'checkout > completes an order', line: 18, tags: ['@checkout'], projects: chromium },
        { title: 'checkout > requires a first name', line: 29, tags: ['@checkout'], projects: chromium },
      ],
    },
    {
      file: 'demo/saucedemo/tests/inventory/inventory.spec.ts',
      tests: [
        { title: 'inventory > sorts products by price low to high', line: 11, tags: ['@inventory'], projects: chromium },
        { title: 'inventory > sorts products by name Z to A', line: 21, tags: ['@inventory'], projects: chromium },
      ],
    },
    {
      file: 'demo/saucedemo/tests/login/login.spec.ts',
      tests: [
        { title: 'login > standard user lands on the products page', line: 7, tags: ['@login'], projects: chromium },
        { title: 'login > locked out user sees an error', line: 18, tags: ['@login'], projects: chromium },
      ],
    },
  ],
};

function newDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  return dir;
}

function write(dir, relPath, content) {
  const file = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function throwsInventoryError(fn, check) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof InventoryError, `expected InventoryError, got ${error}`);
    check(error.message);
    return true;
  });
}

async function rejectsWithInventoryError(promise, check) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof InventoryError, `expected InventoryError, got ${error}`);
    check(error.message);
    return true;
  });
}

// A small list report in the real shape (see the comment at the top of src/inventory/list.ts).
const ROOT = '/repo';
const report = (suites, errors = []) => ({ config: { rootDir: '/repo/demo/shop/tests' }, suites, errors });
const fileSuite = (file, specs, suites) => ({ title: file, file, line: 0, column: 0, specs, ...(suites ? { suites } : {}) });
const spec = (file, title, line, tags, projectNames = ['chromium']) => ({
  title, ok: true, tags, tests: projectNames.map((name) => ({ projectId: name, projectName: name, results: [], status: 'skipped' })),
  file, line, column: 3,
});

test('the recorded fixture parses to the demo inventory written by hand', () => {
  const inventory = parsePlaywrightList(JSON.parse(fixtureText), ROOT, 'demo/saucedemo');
  assert.deepEqual(inventory, DEMO_INVENTORY);
});

test('the parsed fixture is sorted, and every file is repo-relative POSIX', () => {
  const inventory = parsePlaywrightList(JSON.parse(fixtureText), ROOT, 'demo/saucedemo');
  const files = inventory.specs.map((s) => s.file);
  assert.deepEqual(files, [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  for (const s of inventory.specs) {
    assert.ok(!s.file.startsWith('/') && !s.file.includes('\\') && !s.file.includes('/repo'), s.file);
    const lines = s.tests.map((t) => t.line);
    assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
  }
});

test('the raw JSON has the tag "cart" and the inventory has "@cart"', () => {
  const raw = JSON.parse(fixtureText);
  const cartSpec = raw.suites.find((s) => s.file === 'cart/cart.spec.ts').suites[0].specs[0];
  assert.deepEqual(cartSpec.tags, ['cart']);
  const inventory = parsePlaywrightList(raw, ROOT, 'demo/saucedemo');
  assert.deepEqual(inventory.specs[0].tests[0].tags, ['@cart']);
});

test('nested describe blocks give titles joined with >, and an anonymous describe adds nothing', () => {
  const json = report([
    fileSuite('cart.spec.ts', [spec('cart.spec.ts', 'top level test', 2, [])], [
      { title: 'cart', file: 'cart.spec.ts', line: 3, column: 6, specs: [], suites: [
        { title: 'badge', file: 'cart.spec.ts', line: 4, column: 8, specs: [spec('cart.spec.ts', 'shows one item', 5, ['cart'])] },
        { title: '', file: 'cart.spec.ts', line: 7, column: 8, specs: [spec('cart.spec.ts', 'opens the cart', 8, ['cart'])] },
      ] },
    ]),
  ]);
  assert.deepEqual(parsePlaywrightList(json, ROOT, 'demo/shop'), {
    schemaVersion: 1,
    playwrightDir: 'demo/shop',
    specs: [{
      file: 'demo/shop/tests/cart.spec.ts',
      tests: [
        { title: 'top level test', line: 2, tags: [], projects: ['chromium'] },
        { title: 'cart > badge > shows one item', line: 5, tags: ['@cart'], projects: ['chromium'] },
        { title: 'cart > opens the cart', line: 8, tags: ['@cart'], projects: ['chromium'] },
      ],
    }],
  });
});

test('the same test printed once per project gives one test with both projects, sorted', () => {
  const json = report([
    fileSuite('login.spec.ts', [
      spec('login.spec.ts', 'logs in', 4, ['login', 'smoke'], ['webkit']),
      spec('login.spec.ts', 'logs in', 4, ['login', 'smoke'], ['chromium']),
      spec('login.spec.ts', 'shows an error', 9, ['login'], ['webkit', 'chromium']),
    ]),
  ]);
  assert.deepEqual(parsePlaywrightList(json, ROOT, 'demo/shop').specs, [{
    file: 'demo/shop/tests/login.spec.ts',
    tests: [
      { title: 'logs in', line: 4, tags: ['@login', '@smoke'], projects: ['chromium', 'webkit'] },
      { title: 'shows an error', line: 9, tags: ['@login'], projects: ['chromium', 'webkit'] },
    ],
  }]);
});

test('tags are sorted and a spec with no tags gives an empty tag list', () => {
  const json = report([
    fileSuite('checkout.spec.ts', [spec('checkout.spec.ts', 'finishes', 3, ['zeta', 'checkout', 'alpha']), spec('checkout.spec.ts', 'no tags', 6, [])]),
  ]);
  assert.deepEqual(parsePlaywrightList(json, ROOT, 'demo/shop').specs[0].tests, [
    { title: 'finishes', line: 3, tags: ['@alpha', '@checkout', '@zeta'], projects: ['chromium'] },
    { title: 'no tags', line: 6, tags: [], projects: ['chromium'] },
  ]);
});

for (const [label, json] of [
  ['a string', 'not json'],
  ['null', null],
  ['an array', []],
  ['an object with no suites', { config: { rootDir: '/repo/demo/shop/tests' }, errors: [] }],
  ['an object with no config', { suites: [], errors: [] }],
  ['a spec with no title', report([fileSuite('cart.spec.ts', [{ line: 1, tags: [], tests: [] }])])],
]) {
  test(`${label} is not a Playwright list report`, () => {
    throwsInventoryError(() => parsePlaywrightList(json, ROOT, 'demo/shop'), (message) => {
      assert.equal(message, 'The Playwright output is not a JSON list report');
    });
  });
}

test('a report with a non-empty errors list throws with the first line of the first error', () => {
  const json = report([], [
    { message: 'Error: /repo/demo/shop/tests/cart.spec.ts: something broke\n\n  at line 3' },
    { message: 'Error: a second problem' },
  ]);
  throwsInventoryError(() => parsePlaywrightList(json, ROOT, 'demo/shop'), (message) => {
    assert.equal(message, 'Playwright reported an error: Error: demo/shop/tests/cart.spec.ts: something broke');
  });
});

test('a spec file outside the root throws', () => {
  const json = { config: { rootDir: '/elsewhere/tests' }, suites: [fileSuite('cart.spec.ts', [spec('cart.spec.ts', 'adds', 2, [])])], errors: [] };
  throwsInventoryError(() => parsePlaywrightList(json, ROOT, 'demo/shop'), (message) => {
    assert.equal(message, 'Spec file outside the root folder /repo: /elsewhere/tests/cart.spec.ts');
  });
});

test('live: readInventory on this repo matches the recorded fixture', { timeout: 120_000 }, async () => {
  const live = await readInventory(repoRoot, 'demo/saucedemo');
  assert.deepEqual(live, parsePlaywrightList(JSON.parse(fixtureText), ROOT, 'demo/saucedemo'));
  assert.deepEqual(live, DEMO_INVENTORY);
});

test('readInventory without @playwright/test says so and suggests npm ci', async (t) => {
  const dir = newDir(t);
  await rejectsWithInventoryError(readInventory(dir, 'demo/shop'), (message) => {
    assert.equal(message, `@playwright/test was not found from ${dir}. Run npm ci first.`);
  });
});

/** A temp project whose node_modules links to this repo's, so the real Playwright runs. */
function realPlaywrightProject(t) {
  const dir = newDir(t);
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  write(dir, 'demo/shop/playwright.config.ts', lines(
    "import { defineConfig } from '@playwright/test';",
    '',
    "export default defineConfig({ testDir: './tests' });",
  ));
  return dir;
}

test('live: a spec that fails to load gives the first line of the JSON error, with repo-relative paths', { timeout: 120_000 }, async (t) => {
  const dir = realPlaywrightProject(t);
  write(dir, 'demo/shop/tests/broken.spec.ts', lines(
    "import { test } from '@playwright/test';",
    "test('opens the cart', async () => {",
  ));
  await rejectsWithInventoryError(readInventory(dir, 'demo/shop'), (message) => {
    assert.ok(message.startsWith('Playwright reported an error: SyntaxError: demo/shop/tests/broken.spec.ts: '), message);
    assert.ok(!message.includes(dir), message);
    assert.ok(!message.includes('\n'), message);
  });
});

test('live: a Playwright folder with no tests gives No tests found', { timeout: 120_000 }, async (t) => {
  const dir = realPlaywrightProject(t);
  fs.mkdirSync(path.join(dir, 'demo/shop/tests'));
  await rejectsWithInventoryError(readInventory(dir, 'demo/shop'), (message) => {
    assert.equal(message, 'Playwright reported an error: Error: No tests found');
  });
});

/** A temp project with a made-up @playwright/test whose cli.js is the given code. */
function fakePlaywrightProject(t, cliCode) {
  const dir = newDir(t);
  write(dir, 'node_modules/@playwright/test/package.json', JSON.stringify({
    name: '@playwright/test', version: '0.0.0', exports: { './cli': './cli.js' },
  }));
  write(dir, 'node_modules/@playwright/test/cli.js', cliCode);
  fs.mkdirSync(path.join(dir, 'demo/shop'), { recursive: true });
  return dir;
}

test('a failed run with no JSON on stdout gives the first line of stderr', async (t) => {
  const dir = fakePlaywrightProject(t, lines(
    "process.stderr.write('\\nError: the cart list failed\\nsecond line\\n');",
    'process.exitCode = 1;',
  ));
  await rejectsWithInventoryError(readInventory(dir, 'demo/shop'), (message) => {
    assert.equal(message, 'Playwright failed: Error: the cart list failed');
  });
});

test('a failed run with nothing on stdout or stderr gives the exit code', async (t) => {
  const dir = fakePlaywrightProject(t, lines('process.exitCode = 3;'));
  await rejectsWithInventoryError(readInventory(dir, 'demo/shop'), (message) => {
    assert.equal(message, 'Playwright failed with exit code 3');
  });
});

test('a run that exits 0 but prints no JSON is not a list report', async (t) => {
  const dir = fakePlaywrightProject(t, lines("process.stdout.write('Listing tests:\\n');"));
  await rejectsWithInventoryError(readInventory(dir, 'demo/shop'), (message) => {
    assert.equal(message, 'The Playwright output is not a JSON list report');
  });
});

test('readInventory passes an argument array with --forbid-only, removes the git and reporter variables and keeps CI', async (t) => {
  // The fake CLI reports one test whose title records its arguments, cwd and environment.
  const dir = fakePlaywrightProject(t, lines(
    "const path = require('node:path');",
    "const names = ['CI', 'GITHUB_ACTIONS', 'PW_TEST_REPORTER', 'PLAYWRIGHT_JSON_OUTPUT_NAME',",
    "  'PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR', 'PRCHECK_KEPT'];",
    'const seen = { args: process.argv.slice(2), cwd: process.cwd(), env: names.filter((n) => n in process.env) };',
    "const spec = { title: JSON.stringify(seen), tags: [], tests: [{ projectName: 'fake' }], file: 'env.spec.ts', line: 1 };",
    "const rootDir = path.join(process.cwd(), 'demo', 'shop', 'tests');",
    "process.stdout.write(JSON.stringify({ config: { rootDir }, suites: [{ title: 'env.spec.ts', specs: [spec] }], errors: [] }));",
  ));
  const env = {
    CI: 'true', GITHUB_ACTIONS: 'true', PW_TEST_REPORTER: 'dot', PLAYWRIGHT_JSON_OUTPUT_NAME: 'list.json',
    PLAYWRIGHT_JSON_OUTPUT_FILE: 'list.json', PLAYWRIGHT_JSON_OUTPUT_DIR: 'out', PRCHECK_KEPT: 'yes',
  };
  const inventory = await readInventory(dir, 'demo/shop', env);
  assert.equal(inventory.specs[0].file, 'demo/shop/tests/env.spec.ts');
  assert.deepEqual(JSON.parse(inventory.specs[0].tests[0].title), {
    args: ['test', '--list', '--reporter=json', '--forbid-only', '--config', path.join(dir, 'demo', 'shop')],
    cwd: dir,
    env: ['CI', 'PRCHECK_KEPT'],
  });
});
