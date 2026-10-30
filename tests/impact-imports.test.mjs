import test from 'node:test';
import assert from 'node:assert/strict';
import { findImportSpecifiers } from '../dist/impact/index.js';
import { findImportedNames } from '../dist/impact/imports.js';

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

// findImportedNames (PR 7a): the local names import declarations bind. Expected names written by hand.

const NAME_FORMS = [
  ['default import', "import CartPage from './cart-page'", ['CartPage']],
  ['named imports', "import { logStep, addToCart } from '../support/log'", ['logStep', 'addToCart']],
  ['named import with as', "import { addToCart as add } from '../support/log'", ['add']],
  ['default as', "import { default as LoginPage } from './login-page'", ['LoginPage']],
  ['namespace import', "import * as users from '../fixtures/users'", ['users']],
  ['default plus named', "import base, { BasePage } from './base-page'", ['base', 'BasePage']],
  ['default plus namespace', "import base, * as pages from './pages'", ['base', 'pages']],
  ['import type', "import type { Page, Locator } from '@playwright/test';", ['Page', 'Locator']],
  ['import type default', "import type Page from './page'", ['Page']],
  ['import type namespace', "import type * as types from './types'", ['types']],
  ['inline type', "import { type Locator, expect } from '@playwright/test'", ['Locator', 'expect']],
  ['inline type with as', "import { type Locator as L } from '@playwright/test'", ['L']],
  ['a name called type', "import type from './type'", ['type']],
  ['a name called type plus named', "import type, { a } from './type'", ['type', 'a']],
  ['a named import called type', "import { type } from './type'", ['type']],
  ['a string name with as', "import { 'cart-total' as cartTotal } from './cart'", ['cartTotal']],
  ['side effect import', "import './setup'", []],
  ['dynamic import', "const module = await import('./checkout-page')", []],
  ['import.meta', 'const url = import.meta.url', []],
  ['named re-export', "export { CartPage } from './cart-page'", []],
  ['star re-export', "export * as pages from './pages'", []],
  ['require (documented miss)', "const { USERS } = require('../fixtures/users')", []],
  ['import equals require (documented miss)', "import users = require('../fixtures/users')", []],
];

for (const [name, source, expected] of NAME_FORMS) {
  test(`findImportedNames: ${name}`, () => {
    assert.deepEqual(findImportedNames(source), expected);
  });
}

test('findImportedNames: a multi line import, in order, without duplicates', () => {
  const source = lines(
    'import {',
    '  logStep,',
    '  type Waiter,',
    '  addToCart as add,',
    "} from '../support/log'",
    "import { logStep } from '../support/again'",
    "import CartPage from './cart-page'",
  );
  assert.deepEqual(findImportedNames(source), ['logStep', 'Waiter', 'add', 'CartPage']);
});

test('findImportedNames: names in comments, strings, templates and regular expressions are not imports', () => {
  const source = lines(
    "// import { inLineComment } from './a'",
    "/* import { inBlockComment } from './b' */",
    "const s = \"import { inString } from './c'\"",
    "const t = `import { inTemplate } from './d'`",
    "const r = /import { inRegExp } from/",
    "import { real } from './e'",
  );
  assert.deepEqual(findImportedNames(source), ['real']);
});

test('findImportedNames: an unclosed import list ends without error', () => {
  assert.deepEqual(findImportedNames('import { a, b'), ['a', 'b']);
  assert.deepEqual(findImportedNames('import'), []);
  assert.deepEqual(findImportedNames(''), []);
});

test('findImportedNames on a 100000 character list finishes', () => {
  const many = Array.from({ length: 10000 }, (_, i) => `n${i}`);
  assert.equal(findImportedNames(`import { ${many.join(', ')} } from './many'`).length, 10000);
  assert.deepEqual(findImportedNames(`import ${'{ '.repeat(50000)}`), []);
});
