import test from 'node:test';
import assert from 'node:assert/strict';
import { findImportSpecifiers } from '../dist/impact/index.js';

// Each source text is small, made up and SauceDemo style. Expected specifiers are written by hand.
const lines = (...ls) => ls.map((l) => `${l}\n`).join('');

const FORMS = [
  ['default import', "import CartPage from './cart-page';", ['./cart-page']],
  ['named import', "import { CartPage } from '../pages/cart-page';", ['../pages/cart-page']],
  ['type import', "import type { Page } from '@playwright/test';", ['@playwright/test']],
  ['inline type import', "import { type Locator, expect } from '@playwright/test';", ['@playwright/test']],
  ['namespace import', "import * as users from '../fixtures/users';", ['../fixtures/users']],
  ['default plus named import', "import base, { BasePage } from './base-page';", ['./base-page']],
  ['side effect import', "import './setup';", ['./setup']],
  ['named re-export', "export { CartPage } from './cart-page';", ['./cart-page']],
  ['type re-export', "export type { CartItem } from './cart-types';", ['./cart-types']],
  ['star re-export', "export * from './pages';", ['./pages']],
  ['star as re-export', "export * as pages from './pages';", ['./pages']],
  ['re-export of default', "export { default as LoginPage } from './login-page';", ['./login-page']],
  ['dynamic import', "const module = await import('./checkout-page');", ['./checkout-page']],
  ['require', "const { USERS } = require('../fixtures/users');", ['../fixtures/users']],
  ['import equals require', "import users = require('../fixtures/users');", ['../fixtures/users']],
  ['double quotes', 'import { CartPage } from "./cart-page";', ['./cart-page']],
  ['backticks without placeholders', 'import { CartPage } from `./cart-page`;', ['./cart-page']],
  ['no semicolon', "import { CartPage } from './cart-page'\nconst page = 1", ['./cart-page']],
];

for (const [label, source, expected] of FORMS) {
  test(`${label}: ${source.split('\n')[0]}`, () => {
    assert.deepEqual(findImportSpecifiers(source), expected);
  });
}

test('a multi-line import', () => {
  const source = lines(
    'import {',
    '  CartPage,',
    '  type CartItem,',
    "} from './cart-page';",
  );
  assert.deepEqual(findImportSpecifiers(source), ['./cart-page']);
});

test('specifiers come in order of appearance, and the same one twice is returned once', () => {
  const source = lines(
    "import { test } from '@playwright/test';",
    "import { LoginPage } from '../../pages/login-page';",
    "import type { Page } from '@playwright/test';",
    "import { USERS } from '../../fixtures/users';",
    "const again = require('../../pages/login-page');",
  );
  assert.deepEqual(findImportSpecifiers(source), ['@playwright/test', '../../pages/login-page', '../../fixtures/users']);
});

test('commented out imports are ignored, in line and block comments', () => {
  const source = lines(
    "// import { OldPage } from './old-page';",
    '/* import { DraftPage } from "./draft-page";',
    "   export * from './draft'; */",
    "/** require('./doc-only') */",
    "import { CartPage } from './cart-page'; // import './trailing'",
  );
  assert.deepEqual(findImportSpecifiers(source), ['./cart-page']);
});

test('import-like text inside a string or a template literal is ignored', () => {
  const source = lines(
    "const a = \"import x from 'b'\";",
    "const c = 'export * from \"d\"';",
    "const e = `import f from 'g'`;",
    "const h = `require('i') ${value} import j from 'k'`;",
    "const l = `${`import m from 'n'`}`;",
    "import { CartPage } from './cart-page';",
  );
  assert.deepEqual(findImportSpecifiers(source), ['./cart-page']);
});

test('an apostrophe in a comment does not break the scan', () => {
  const source = lines(
    "// The cart page doesn't wait, so it's checked here.",
    "import { CartPage } from './cart-page';",
    "/* SauceDemo's backpack is the first item. */",
    "import { USERS } from '../fixtures/users';",
  );
  assert.deepEqual(findImportSpecifiers(source), ['./cart-page', '../fixtures/users']);
});

test('quotes inside a regular expression literal do not start a string', () => {
  const source = lines(
    "const quote = /'/;",
    "import { CartPage } from './cart-page';",
    "const price = total / count; const tick = /\\'[\"]/g.test(text);",
    "import { USERS } from '../fixtures/users';",
  );
  assert.deepEqual(findImportSpecifiers(source), ['./cart-page', '../fixtures/users']);
});

test('dynamic import and require with a variable return nothing', () => {
  const source = lines(
    "const name = './cart-page';",
    'const a = await import(name);',
    'const b = require(name);',
    "const c = await import('./pages/' + name);",
    'const d = await import(`./pages/${name}`);',
  );
  assert.deepEqual(findImportSpecifiers(source), []);
});

test('bare specifiers are returned as written; the graph filters them', () => {
  const source = lines(
    "import { test } from '@playwright/test';",
    "import fs from 'node:fs';",
    "import path from 'path';",
  );
  assert.deepEqual(findImportSpecifiers(source), ['@playwright/test', 'node:fs', 'path']);
});

test('local exports and import.meta are not specifiers', () => {
  const source = lines(
    "export const from = 'not-a-module';",
    "export default 'cart';",
    'export { CartPage };',
    "const url = new URL('./data.json', import.meta.url);",
    "export function load() { return 'x'; }",
  );
  assert.deepEqual(findImportSpecifiers(source), []);
});

test('the demo cart spec gives its five specifiers', () => {
  // The first lines of demo/saucedemo/tests/cart/cart.spec.ts, as read from the file.
  const source = lines(
    "import { expect, test } from '@playwright/test';",
    "import { USERS } from '../../fixtures/users';",
    "import { CartPage } from '../../pages/cart-page';",
    "import { InventoryPage } from '../../pages/inventory-page';",
    "import { LoginPage } from '../../pages/login-page';",
    '',
    "test.describe('cart', { tag: '@cart' }, () => {});",
  );
  assert.deepEqual(findImportSpecifiers(source), [
    '@playwright/test', '../../fixtures/users', '../../pages/cart-page', '../../pages/inventory-page', '../../pages/login-page',
  ]);
});
