import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildImportGraph } from '../dist/impact/index.js';
import { parsePlaywrightList } from '../dist/inventory/index.js';
import { cleanup } from './helpers/git-repo.mjs';

// Each case writes a small made-up project into a temp folder. Expected graphs are written by hand
// from the files the case writes. Maps are compared as entry lists, so key order is checked too.

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lines = (...ls) => ls.map((l) => `${l}\n`).join('');

function newDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  return dir;
}

function project(t, files) {
  const dir = newDir(t);
  for (const [relPath, content] of Object.entries(files)) {
    const file = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

function assertGraph(graph, { imports, importedBy, warnings = [] }) {
  assert.deepEqual([...graph.imports], imports);
  assert.deepEqual([...graph.importedBy], importedBy);
  assert.deepEqual(graph.warnings, warnings);
}

const PAGE = lines('export class CartPage {}');

test('an extensionless import resolves to the .ts file', (t) => {
  const dir = project(t, {
    'tests/cart.spec.ts': lines("import { CartPage } from '../pages/cart-page';"),
    'pages/cart-page.ts': PAGE,
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts']), {
    imports: [['pages/cart-page.ts', []], ['tests/cart.spec.ts', ['pages/cart-page.ts']]],
    importedBy: [['pages/cart-page.ts', ['tests/cart.spec.ts']]],
  });
});

test('a .js specifier resolves to the .ts file', (t) => {
  const dir = project(t, {
    'pages/index.ts': lines("export { CartPage } from './cart-page.js';"),
    'pages/cart-page.ts': PAGE,
  });
  assertGraph(buildImportGraph(dir, ['pages/index.ts']), {
    imports: [['pages/cart-page.ts', []], ['pages/index.ts', ['pages/cart-page.ts']]],
    importedBy: [['pages/cart-page.ts', ['pages/index.ts']]],
  });
});

test('a .jsx specifier resolves to the .tsx file', (t) => {
  const dir = project(t, {
    'tests/badge.spec.tsx': lines("import { Badge } from '../components/badge.jsx';"),
    'components/badge.tsx': lines('export const Badge = () => null;'),
  });
  assertGraph(buildImportGraph(dir, ['tests/badge.spec.tsx']), {
    imports: [['components/badge.tsx', []], ['tests/badge.spec.tsx', ['components/badge.tsx']]],
    importedBy: [['components/badge.tsx', ['tests/badge.spec.tsx']]],
  });
});

test('a .mjs specifier resolves to the .mts file', (t) => {
  const dir = project(t, {
    'tests/cart.spec.mts': lines("import { total } from '../utils/total.mjs';"),
    'utils/total.mts': lines('export const total = 0;'),
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.mts']), {
    imports: [['tests/cart.spec.mts', ['utils/total.mts']], ['utils/total.mts', []]],
    importedBy: [['utils/total.mts', ['tests/cart.spec.mts']]],
  });
});

test('an explicit .ts import resolves as written', (t) => {
  const dir = project(t, {
    'tests/cart.spec.ts': lines("import { CartPage } from '../pages/cart-page.ts';"),
    'pages/cart-page.ts': PAGE,
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts']), {
    imports: [['pages/cart-page.ts', []], ['tests/cart.spec.ts', ['pages/cart-page.ts']]],
    importedBy: [['pages/cart-page.ts', ['tests/cart.spec.ts']]],
  });
});

test('a folder import resolves to its index.ts', (t) => {
  const dir = project(t, {
    'tests/cart.spec.ts': lines("import { CartPage } from '../pages';", "import { USERS } from '../fixtures/';"),
    'pages/index.ts': lines("export * from './cart-page';"),
    'pages/cart-page.ts': PAGE,
    'fixtures/index.ts': lines("export const USERS = ['standard_user'];"),
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts']), {
    imports: [
      ['fixtures/index.ts', []],
      ['pages/cart-page.ts', []],
      ['pages/index.ts', ['pages/cart-page.ts']],
      ['tests/cart.spec.ts', ['fixtures/index.ts', 'pages/index.ts']],
    ],
    importedBy: [
      ['fixtures/index.ts', ['tests/cart.spec.ts']],
      ['pages/cart-page.ts', ['pages/index.ts']],
      ['pages/index.ts', ['tests/cart.spec.ts']],
    ],
  });
});

test('when a.ts and a.js both exist, ./a gives a.ts and ./a.js gives a.js', (t) => {
  const dir = project(t, {
    'tests/one.spec.ts': lines("import { a } from '../lib/a';"),
    'tests/two.spec.ts': lines("import { a } from '../lib/a.js';"),
    'lib/a.ts': lines('export const a = 1;'),
    'lib/a.js': lines('export const a = 1;'),
  });
  assertGraph(buildImportGraph(dir, ['tests/one.spec.ts', 'tests/two.spec.ts']), {
    imports: [
      ['lib/a.js', []],
      ['lib/a.ts', []],
      ['tests/one.spec.ts', ['lib/a.ts']],
      ['tests/two.spec.ts', ['lib/a.js']],
    ],
    importedBy: [['lib/a.js', ['tests/two.spec.ts']], ['lib/a.ts', ['tests/one.spec.ts']]],
  });
});

test('an import type is followed', (t) => {
  const dir = project(t, {
    'tests/cart.spec.ts': lines("import type { CartItem } from '../pages/cart-types';"),
    'pages/cart-types.ts': lines('export interface CartItem { name: string }'),
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts']), {
    imports: [['pages/cart-types.ts', []], ['tests/cart.spec.ts', ['pages/cart-types.ts']]],
    importedBy: [['pages/cart-types.ts', ['tests/cart.spec.ts']]],
  });
});

test('require in a .js file is followed', (t) => {
  const dir = project(t, {
    'tests/cart.spec.js': lines("const { login } = require('../helpers/login');"),
    'helpers/login.js': lines('module.exports = { login() {} };'),
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.js']), {
    imports: [['helpers/login.js', []], ['tests/cart.spec.js', ['helpers/login.js']]],
    importedBy: [['helpers/login.js', ['tests/cart.spec.js']]],
  });
});

test('a .json import is a leaf and is not read', (t) => {
  // If the JSON were scanned, the text below would add an Unresolved import warning.
  const dir = project(t, {
    'tests/login.spec.ts': lines("import users from '../fixtures/users.json';"),
    'fixtures/users.json': lines('{ "note": "import x from \'./missing\'" }'),
  });
  assertGraph(buildImportGraph(dir, ['tests/login.spec.ts']), {
    imports: [['fixtures/users.json', []], ['tests/login.spec.ts', ['fixtures/users.json']]],
    importedBy: [['fixtures/users.json', ['tests/login.spec.ts']]],
  });
});

test('three levels: spec to page to base page to util, in imports and importedBy', (t) => {
  const dir = project(t, {
    'tests/cart.spec.ts': lines("import { CartPage } from '../pages/cart-page';"),
    'pages/cart-page.ts': lines("import { BasePage } from './base-page';"),
    'pages/base-page.ts': lines("import { formatPrice } from '../utils/format-price';"),
    'utils/format-price.ts': lines('export const formatPrice = (n: number) => `$${n}`;'),
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts']), {
    imports: [
      ['pages/base-page.ts', ['utils/format-price.ts']],
      ['pages/cart-page.ts', ['pages/base-page.ts']],
      ['tests/cart.spec.ts', ['pages/cart-page.ts']],
      ['utils/format-price.ts', []],
    ],
    importedBy: [
      ['pages/base-page.ts', ['pages/cart-page.ts']],
      ['pages/cart-page.ts', ['tests/cart.spec.ts']],
      ['utils/format-price.ts', ['pages/base-page.ts']],
    ],
  });
});

test('a cycle terminates and each file is listed once', (t) => {
  const dir = project(t, {
    'tests/cart.spec.ts': lines("import { a } from '../lib/a';"),
    'lib/a.ts': lines("import { b } from './b';", 'export const a = 1;'),
    'lib/b.ts': lines("import { a } from './a';", "import { a as again } from './a.ts';", 'export const b = 2;'),
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts']), {
    imports: [['lib/a.ts', ['lib/b.ts']], ['lib/b.ts', ['lib/a.ts']], ['tests/cart.spec.ts', ['lib/a.ts']]],
    importedBy: [['lib/a.ts', ['lib/b.ts', 'tests/cart.spec.ts']], ['lib/b.ts', ['lib/a.ts']]],
  });
});

test('commented out imports are not followed', (t) => {
  const dir = project(t, {
    'tests/cart.spec.ts': lines(
      "// import { OldPage } from '../pages/old-page';",
      "/* import { DraftPage } from '../pages/draft-page'; */",
      "import { CartPage } from '../pages/cart-page';",
    ),
    'pages/cart-page.ts': PAGE,
    'pages/old-page.ts': PAGE,
    'pages/draft-page.ts': PAGE,
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts']), {
    imports: [['pages/cart-page.ts', []], ['tests/cart.spec.ts', ['pages/cart-page.ts']]],
    importedBy: [['pages/cart-page.ts', ['tests/cart.spec.ts']]],
  });
});

test('bare specifiers are ignored without a warning', (t) => {
  const dir = project(t, {
    'tests/cart.spec.ts': lines(
      "import { test } from '@playwright/test';",
      "import fs from 'node:fs';",
      "import lodash from 'lodash';",
    ),
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts']), {
    imports: [['tests/cart.spec.ts', []]],
    importedBy: [],
  });
});

test('an unresolved relative import gives the exact warning', (t) => {
  const dir = project(t, {
    'tests/cart.spec.ts': lines("import { WishlistPage } from '../pages/wishlist-page';"),
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts']), {
    imports: [['tests/cart.spec.ts', []]],
    importedBy: [],
    warnings: ['Unresolved import "../pages/wishlist-page" in tests/cart.spec.ts'],
  });
});

test('an import that leaves the root gives the exact warning, also through a symlink', (t) => {
  const outer = newDir(t);
  const dir = path.join(outer, 'repo');
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'pages'));
  fs.writeFileSync(path.join(outer, 'shared.ts'), lines('export const shared = 1;'));
  fs.symlinkSync(path.join(outer, 'shared.ts'), path.join(dir, 'pages', 'linked.ts'));
  fs.writeFileSync(path.join(dir, 'tests', 'cart.spec.ts'), lines(
    "import { shared } from '../../shared';",
    "import { linked } from '../pages/linked';",
  ));
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts']), {
    imports: [['tests/cart.spec.ts', []]],
    importedBy: [],
    warnings: [
      'Import outside the repository ignored: "../../shared" in tests/cart.spec.ts',
      'Import outside the repository ignored: "../pages/linked" in tests/cart.spec.ts',
    ],
  });
});

test('imports into node_modules or dist are ignored without a warning', (t) => {
  const dir = project(t, {
    'tests/cart.spec.ts': lines(
      "import { helper } from '../node_modules/shop-helpers/index.js';",
      "import { built } from '../dist/built.js';",
    ),
    'node_modules/shop-helpers/index.js': lines('export const helper = 1;'),
    'dist/built.js': lines('export const built = 1;'),
  });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts']), {
    imports: [['tests/cart.spec.ts', []]],
    importedBy: [],
  });
});

test('an entry that cannot be read gives a warning and is left out', (t) => {
  const dir = project(t, { 'tests/cart.spec.ts': lines('export {};') });
  assertGraph(buildImportGraph(dir, ['tests/cart.spec.ts', 'tests/missing.spec.ts']), {
    imports: [['tests/cart.spec.ts', []]],
    importedBy: [],
    warnings: ['Cannot read tests/missing.spec.ts'],
  });
});

test('two runs give identical, sorted output', (t) => {
  const dir = project(t, {
    'tests/z.spec.ts': lines("import { b } from '../lib/b';", "import { a } from '../lib/a';", "import './missing-z';"),
    'tests/a.spec.ts': lines("import { c } from '../lib/c';", "import { b } from '../lib/b';", "import './missing-a';"),
    'lib/a.ts': lines("import { c } from './c';"),
    'lib/b.ts': lines("import { a } from './a';"),
    'lib/c.ts': lines('export const c = 1;'),
  });
  const first = buildImportGraph(dir, ['tests/z.spec.ts', 'tests/a.spec.ts']);
  const second = buildImportGraph(dir, ['tests/a.spec.ts', 'tests/z.spec.ts']);
  assert.deepEqual([...first.imports], [...second.imports]);
  assert.deepEqual([...first.importedBy], [...second.importedBy]);
  assert.deepEqual(first.warnings, second.warnings);
  assertGraph(first, {
    imports: [
      ['lib/a.ts', ['lib/c.ts']],
      ['lib/b.ts', ['lib/a.ts']],
      ['lib/c.ts', []],
      ['tests/a.spec.ts', ['lib/b.ts', 'lib/c.ts']],
      ['tests/z.spec.ts', ['lib/a.ts', 'lib/b.ts']],
    ],
    importedBy: [
      ['lib/a.ts', ['lib/b.ts', 'tests/z.spec.ts']],
      ['lib/b.ts', ['tests/a.spec.ts', 'tests/z.spec.ts']],
      ['lib/c.ts', ['lib/a.ts', 'tests/a.spec.ts']],
    ],
    warnings: ['Unresolved import "./missing-a" in tests/a.spec.ts', 'Unresolved import "./missing-z" in tests/z.spec.ts'],
  });
});

test('demo: the graph of the demo specs and config matches the graph read by hand', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'inventory', 'demo-list.json'), 'utf8'));
  const specs = parsePlaywrightList(fixture, '/repo', 'demo/saucedemo').specs.map((s) => s.file);
  const graph = buildImportGraph(repoRoot, [...specs, 'demo/saucedemo/playwright.config.ts']);

  // Written by hand from the import lines of every file under demo/saucedemo.
  const d = (file) => `demo/saucedemo/${file}`;
  const users = d('fixtures/users.ts');
  const cartPage = d('pages/cart-page.ts');
  const checkoutPage = d('pages/checkout-page.ts');
  const inventoryPage = d('pages/inventory-page.ts');
  const loginPage = d('pages/login-page.ts');
  const cartSpec = d('tests/cart/cart.spec.ts');
  const checkoutSpec = d('tests/checkout/checkout.spec.ts');
  const inventorySpec = d('tests/inventory/inventory.spec.ts');
  const loginSpec = d('tests/login/login.spec.ts');
  assertGraph(graph, {
    imports: [
      [users, []],
      [cartPage, []],
      [checkoutPage, []],
      [inventoryPage, []],
      [loginPage, [users]],
      [d('playwright.config.ts'), []],
      [cartSpec, [users, cartPage, inventoryPage, loginPage]],
      [checkoutSpec, [users, cartPage, checkoutPage, inventoryPage, loginPage]],
      [inventorySpec, [users, inventoryPage, loginPage]],
      [loginSpec, [users, inventoryPage, loginPage]],
    ],
    importedBy: [
      [users, [loginPage, cartSpec, checkoutSpec, inventorySpec, loginSpec]],
      [cartPage, [cartSpec, checkoutSpec]],
      [checkoutPage, [checkoutSpec]],
      [inventoryPage, [cartSpec, checkoutSpec, inventorySpec, loginSpec]],
      [loginPage, [cartSpec, checkoutSpec, inventorySpec, loginSpec]],
    ],
  });
});
