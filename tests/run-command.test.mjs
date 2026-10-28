import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlaywrightArgs } from '../dist/run/index.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Playwright's own filter for positional arguments, from the installed 1.60.0 (an exported subpath).
const { suiteUtils } = createRequire(path.join(repoRoot, 'package.json'))('playwright/lib/common');

const ROOT = '/repo';
const CART = 'demo/saucedemo/tests/cart/cart.spec.ts';
const CHECKOUT = 'demo/saucedemo/tests/checkout/checkout.spec.ts';
const OPTIONS = ['--reporter=json', '--pass-with-no-tests'];

function selection(mode, files, playwrightDir = 'demo/saucedemo') {
  return {
    schemaVersion: 1,
    source: { type: 'file', path: 'changes.diff' },
    mode,
    playwrightDir,
    totalSpecs: 4,
    totalTests: 8,
    selected: files.map((file) => ({ file, testCount: 2, tags: ['@cart'], reasons: ['Spec changed: x'] })),
    fullSuiteReasons: mode === 'full' ? ['Lockfile changed: package-lock.json'] : [],
    decisions: [],
    warnings: [],
  };
}

test('mode none gives null', () => {
  assert.equal(buildPlaywrightArgs(selection('none', []), ROOT), null);
});

test('mode full gives the config, the JSON reporter and no file filter', () => {
  assert.deepEqual(buildPlaywrightArgs(selection('full', [CART, CHECKOUT]), ROOT), {
    args: ['test', '--config', '/repo/demo/saucedemo', ...OPTIONS],
    display: ['test', '--config', 'demo/saucedemo', ...OPTIONS],
  });
});

test('mode subset with one spec gives one anchored filter, shown with <root>', () => {
  assert.deepEqual(buildPlaywrightArgs(selection('subset', [CART]), ROOT), {
    args: ['test', '--config', '/repo/demo/saucedemo', ...OPTIONS, '/^/repo/demo/saucedemo/tests/cart/cart\\.spec\\.ts$/'],
    display: ['test', '--config', 'demo/saucedemo', ...OPTIONS, '/^<root>/demo/saucedemo/tests/cart/cart\\.spec\\.ts$/'],
  });
});

test('mode subset with two specs gives one filter per spec', () => {
  assert.deepEqual(buildPlaywrightArgs(selection('subset', [CART, CHECKOUT]), ROOT), {
    args: [
      'test', '--config', '/repo/demo/saucedemo', ...OPTIONS,
      '/^/repo/demo/saucedemo/tests/cart/cart\\.spec\\.ts$/',
      '/^/repo/demo/saucedemo/tests/checkout/checkout\\.spec\\.ts$/',
    ],
    display: [
      'test', '--config', 'demo/saucedemo', ...OPTIONS,
      '/^<root>/demo/saucedemo/tests/cart/cart\\.spec\\.ts$/',
      '/^<root>/demo/saucedemo/tests/checkout/checkout\\.spec\\.ts$/',
    ],
  });
});

test('the order of the selected list does not change the arguments', () => {
  assert.deepEqual(
    buildPlaywrightArgs(selection('subset', [CHECKOUT, CART]), ROOT),
    buildPlaywrightArgs(selection('subset', [CART, CHECKOUT]), ROOT),
  );
});

test('every regular expression character in a path is escaped', () => {
  const file = 'demo/shop/tests/sale (50%)/price+tax[eu].spec.ts';
  assert.deepEqual(buildPlaywrightArgs(selection('subset', [file], 'demo/shop'), ROOT).args.at(-1),
    '/^/repo/demo/shop/tests/sale \\(50%\\)/price\\+tax\\[eu\\]\\.spec\\.ts$/');
});

test('a Playwright folder at the root shows as . and resolves to the root', () => {
  assert.deepEqual(buildPlaywrightArgs(selection('full', ['tests/cart.spec.ts'], '.'), ROOT), {
    args: ['test', '--config', '/repo', ...OPTIONS],
    display: ['test', '--config', '.', ...OPTIONS],
  });
});

// Paths a filter for /repo/demo/saucedemo/tests/cart/cart.spec.ts must not match.
const DECOYS = {
  tsx: '/repo/demo/saucedemo/tests/cart/cart.spec.tsx',
  miniCart: '/repo/demo/saucedemo/tests/cart/mini-cart.spec.ts',
  nested: '/repo/other/demo/saucedemo/tests/cart/cart.spec.ts',
  upperCase: '/repo/demo/saucedemo/tests/Cart/Cart.spec.ts',
  anyCharacter: '/repo/demo/saucedemo/tests/cart/cartXspec.ts',
  otherRoot: '/x/repo/demo/saucedemo/tests/cart/cart.spec.ts',
};
const matches = (arg, file) => suiteUtils.createFiltersFromArguments([arg]).fileFilter(file);

test("Playwright's own filter matches the built argument against the selected file only", () => {
  const arg = buildPlaywrightArgs(selection('subset', [CART]), ROOT).args.at(-1);
  assert.equal(matches(arg, '/repo/demo/saucedemo/tests/cart/cart.spec.ts'), true);
  for (const [name, decoy] of Object.entries(DECOYS)) assert.equal(matches(arg, decoy), false, name);
});

test("control: Playwright's filter reads a plain path as a loose pattern that over-matches", () => {
  // Written from forceRegExp in playwright 1.60.0: a plain argument becomes new RegExp(arg, 'gi').
  const plain = CART;
  assert.deepEqual(Object.fromEntries(Object.entries(DECOYS).map(([name, decoy]) => [name, matches(plain, decoy)])), {
    tsx: true, miniCart: false, nested: true, upperCase: true, anyCharacter: true, otherRoot: true,
  });
});
