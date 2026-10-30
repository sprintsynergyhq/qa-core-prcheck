import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyPath } from '../dist/diff/index.js';
import { buildImportGraph, mapImpact } from '../dist/impact/index.js';
import { cleanup } from './helpers/git-repo.mjs';

/**
 * mapImpact on a small made-up SauceDemo style project under demo/shop/. The import graph of that
 * project, read by hand from SHOP_FILES:
 *
 *   tests/login.spec.ts     -> pages/login-page.ts, fixtures/users.ts
 *   tests/cart.spec.ts      -> pages/cart-page.ts, pages/login-page.ts
 *   tests/checkout.spec.ts  -> pages/checkout-page.ts
 *   pages/login-page.ts     -> pages/base-page.ts
 *   pages/cart-page.ts      -> pages/base-page.ts
 *   pages/checkout-page.ts  -> pages/base-page.ts, pages/cart-page.ts
 *   pages/base-page.ts      -> utils/format-price.ts
 *   playwright.config.ts    -> support/env.ts
 *   pages/promo-page.ts and fixtures/users.json: imported by nothing
 *
 * Every expected Selection below is written by hand from that graph, the rules in src/impact/map.ts and the
 * suggestion rules in src/suggest/suggest.ts.
 */

const lines = (...ls) => ls.map((l) => `${l}\n`).join('');

const SHOP_FILES = {
  'demo/shop/playwright.config.ts': lines(
    "import { defineConfig } from '@playwright/test';",
    "import { BASE_URL } from './support/env';",
    '',
    "export default defineConfig({ testDir: './tests', use: { baseURL: BASE_URL } });",
  ),
  'demo/shop/support/env.ts': lines("export const BASE_URL = 'https://www.saucedemo.com';"),
  'demo/shop/tests/login.spec.ts': lines(
    "import { test } from '@playwright/test';",
    "import { USERS } from '../fixtures/users';",
    "import { LoginPage } from '../pages/login-page';",
    '',
    "test.describe('login', { tag: '@login' }, () => {",
    "  test('standard user logs in', async ({ page }) => {",
    '    await new LoginPage(page).login(USERS.standard);',
    '  });',
    '',
    "  test('locked out user sees an error', async ({ page }) => {",
    '    await new LoginPage(page).login(USERS.lockedOut);',
    '  });',
    '});',
  ),
  'demo/shop/tests/cart.spec.ts': lines(
    "import { test } from '@playwright/test';",
    "import { CartPage } from '../pages/cart-page';",
    "import { LoginPage } from '../pages/login-page';",
    '',
    "test.describe('cart', { tag: '@cart' }, () => {",
    "  test('adds a backpack', async ({ page }) => {",
    "    await new LoginPage(page).login('standard_user');",
    '    await new CartPage(page).open();',
    '  });',
    '',
    "  test('removes a backpack', async ({ page }) => {",
    '    await new CartPage(page).open();',
    '  });',
    '});',
  ),
  'demo/shop/tests/checkout.spec.ts': lines(
    "import { test } from '@playwright/test';",
    "import { CheckoutPage } from '../pages/checkout-page';",
    '',
    "test.describe('checkout', { tag: '@checkout' }, () => {",
    "  test('completes an order', async ({ page }) => {",
    '    await new CheckoutPage(page).finish();',
    '  });',
    '});',
  ),
  'demo/shop/pages/base-page.ts': lines(
    "import type { Page } from '@playwright/test';",
    "import { formatPrice } from '../utils/format-price';",
    '',
    'export class BasePage {',
    '  constructor(readonly page: Page) {}',
    '  price(value: number): string { return formatPrice(value); }',
    '}',
  ),
  'demo/shop/pages/login-page.ts': lines(
    "import { BasePage } from './base-page';",
    '',
    'export class LoginPage extends BasePage {',
    "  async login(user: string) { await this.page.goto('/'); await this.page.getByTestId('username').fill(user); }",
    '}',
  ),
  'demo/shop/pages/cart-page.ts': lines(
    "import { BasePage } from './base-page';",
    '',
    'export class CartPage extends BasePage {',
    "  async open() { await this.page.goto('/cart.html'); }",
    '}',
  ),
  'demo/shop/pages/checkout-page.ts': lines(
    "import { BasePage } from './base-page';",
    "import { CartPage } from './cart-page';",
    '',
    'export class CheckoutPage extends BasePage {',
    "  async finish() { await new CartPage(this.page).open(); await this.page.getByTestId('finish').click(); }",
    '}',
  ),
  'demo/shop/pages/promo-page.ts': lines(
    "import { BasePage } from './base-page';",
    '',
    'export class PromoPage extends BasePage {}',
  ),
  'demo/shop/fixtures/users.ts': lines("export const USERS = { standard: 'standard_user', lockedOut: 'locked_out_user' };"),
  'demo/shop/fixtures/users.json': lines('{ "standard": "standard_user" }'),
  'demo/shop/utils/format-price.ts': lines('export const formatPrice = (value: number): string => `$${value.toFixed(2)}`;'),
};

const CONFIG_ENTRY = 'demo/shop/playwright.config.ts';
const CART = 'demo/shop/tests/cart.spec.ts';
const CHECKOUT = 'demo/shop/tests/checkout.spec.ts';
const LOGIN = 'demo/shop/tests/login.spec.ts';
const FULL_RUN = 'Part of the full suite run';
const SOURCE = { type: 'file', path: 'changes.diff' };

// Written by hand from the specs in SHOP_FILES.
const chromium = ['chromium'];
const INVENTORY = {
  schemaVersion: 1,
  playwrightDir: 'demo/shop',
  specs: [
    { file: CART, tests: [
      { title: 'cart > adds a backpack', line: 6, tags: ['@cart'], projects: chromium },
      { title: 'cart > removes a backpack', line: 11, tags: ['@cart'], projects: chromium },
    ] },
    { file: CHECKOUT, tests: [
      { title: 'checkout > completes an order', line: 5, tags: ['@checkout'], projects: chromium },
    ] },
    { file: LOGIN, tests: [
      { title: 'login > standard user logs in', line: 6, tags: ['@login'], projects: chromium },
      { title: 'login > locked out user sees an error', line: 10, tags: ['@login'], projects: chromium },
    ] },
  ],
};

const NO_CONFIG = { playwrightDir: 'demo/shop', areas: [], fullSuiteOn: [], ignore: [] };

function shopGraph(t, extraFiles = {}, inventory = INVENTORY) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  for (const [relPath, content] of Object.entries({ ...SHOP_FILES, ...extraFiles })) {
    const file = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return buildImportGraph(dir, [...inventory.specs.map((s) => s.file), CONFIG_ENTRY]);
}

/** A ChangedFile as the diff reader builds it; the status is written by hand. */
function changed(filePath, status = 'modified', oldPath = null) {
  return {
    path: filePath, oldPath, status, similarity: oldPath === null ? null : 100,
    binary: false, additions: 0, deletions: 0, ranges: [], fileClass: classifyPath(filePath),
  };
}

function run(t, files, config = {}, { extraFiles, inventory = INVENTORY, texts = new Map() } = {}) {
  return mapImpact({
    source: SOURCE, files, inventory, graph: shopGraph(t, extraFiles, inventory),
    configEntry: CONFIG_ENTRY, config: { ...NO_CONFIG, ...config }, texts,
  });
}

const expected = ({ mode, selected = [], fullSuiteReasons = [], decisions, warnings = [], suggestions = [], totalSpecs = 3, totalTests = 5 }) => ({
  schemaVersion: 1, source: SOURCE, mode, playwrightDir: 'demo/shop', totalSpecs, totalTests,
  selected, fullSuiteReasons, decisions, warnings, suggestions,
});
const unmapped = (file) => ({
  file,
  kind: 'unmapped-file',
  reason: 'No rule or spec maps this file, so it falls back to the full suite.',
  idea: `Add a spec that covers the behaviour in ${file}, or map it to a tag with an area in qa-core-prcheck.config.json.`,
});
const unimported = (file) => ({
  file,
  kind: 'unimported-support',
  reason: 'No spec imports this file.',
  idea: `Add a spec that imports ${file} and uses it, or remove the file if nothing needs it.`,
});
const decision = (filePath, fileClass, status, outcome, reason, specs = []) => ({ path: filePath, fileClass, status, outcome, reason, specs });
const cart = (...reasons) => ({ file: CART, testCount: 2, tags: ['@cart'], reasons });
const checkout = (...reasons) => ({ file: CHECKOUT, testCount: 1, tags: ['@checkout'], reasons });
const login = (...reasons) => ({ file: LOGIN, testCount: 2, tags: ['@login'], reasons });
const everySpecFull = [cart(FULL_RUN), checkout(FULL_RUN), login(FULL_RUN)];

// Rule 1: ignore

test('rule 1: an ignored lockfile gives outcome ignored and mode none', (t) => {
  assert.deepEqual(run(t, [changed('package-lock.json')], { ignore: ['package-lock.json'] }), expected({
    mode: 'none',
    decisions: [decision('package-lock.json', 'lockfile', 'modified', 'ignored', 'Ignored by pattern "package-lock.json"')],
  }));
});

test('rule 1: ignore beats a changed spec, and names the first matching glob in sorted order', (t) => {
  assert.deepEqual(run(t, [changed(CART)], { ignore: ['demo/shop/tests/**', 'demo/shop/tests/cart.spec.ts'] }), expected({
    mode: 'none',
    decisions: [decision(CART, 'spec', 'modified', 'ignored', 'Ignored by pattern "demo/shop/tests/**"')],
  }));
});

// Rule 2: full suite triggers

for (const [filePath, fileClass, reason] of [
  ['package-lock.json', 'lockfile', 'Lockfile changed: package-lock.json'],
  ['package.json', 'package-manifest', 'Package manifest changed: package.json'],
  [CONFIG_ENTRY, 'playwright-config', 'Playwright config changed: demo/shop/playwright.config.ts'],
  ['.github/workflows/ci.yml', 'ci-workflow', 'CI workflow changed: .github/workflows/ci.yml'],
]) {
  test(`rule 2: ${filePath} gives mode full with "${reason}"`, (t) => {
    assert.deepEqual(run(t, [changed(filePath)]), expected({
      mode: 'full',
      selected: everySpecFull,
      fullSuiteReasons: [reason],
      decisions: [decision(filePath, fileClass, 'modified', 'full', reason)],
    }));
  });
}

test('rule 2: a fullSuiteOn match gives mode full, before the import rules', (t) => {
  const reason = 'demo/shop/fixtures/users.ts matches fullSuiteOn pattern "demo/shop/fixtures/**"';
  assert.deepEqual(run(t, [changed('demo/shop/fixtures/users.ts')], { fullSuiteOn: ['demo/shop/fixtures/**'] }), expected({
    mode: 'full',
    selected: everySpecFull,
    fullSuiteReasons: [reason],
    decisions: [decision('demo/shop/fixtures/users.ts', 'test-data', 'modified', 'full', reason)],
  }));
});

// Rule 3: changed spec

test('rule 3: a changed spec selects only itself when no spec imports it', (t) => {
  assert.deepEqual(run(t, [changed(CART)]), expected({
    mode: 'subset',
    selected: [cart(`Spec changed: ${CART}`)],
    decisions: [decision(CART, 'spec', 'modified', 'specs', `Spec changed: ${CART}`, [CART])],
  }));
});

test('rule 3: an added spec selects itself', (t) => {
  assert.deepEqual(run(t, [changed(LOGIN, 'added')]), expected({
    mode: 'subset',
    selected: [login(`Spec changed: ${LOGIN}`)],
    decisions: [decision(LOGIN, 'spec', 'added', 'specs', `Spec changed: ${LOGIN}`, [LOGIN])],
  }));
});

test('rule 3: a renamed spec selects itself, and its old path is a renamed spec, never a deleted one', (t) => {
  const oldPath = 'demo/shop/tests/order.spec.ts';
  assert.deepEqual(run(t, [changed(CHECKOUT, 'renamed', oldPath)]), expected({
    mode: 'subset',
    selected: [checkout(`Spec changed: ${CHECKOUT}`)],
    decisions: [
      decision(CHECKOUT, 'spec', 'renamed', 'specs', `Spec changed: ${CHECKOUT}`, [CHECKOUT]),
      decision(oldPath, 'spec', 'deleted', 'none', `Spec renamed: ${oldPath} to ${CHECKOUT}`),
    ],
  }));
});

test('rule 3: a changed spec also selects every spec that imports it, directly or through other files', (t) => {
  const SMOKE = 'demo/shop/tests/smoke.spec.ts';
  const NIGHTLY = 'demo/shop/tests/nightly.spec.ts';
  const extraFiles = {
    [SMOKE]: lines("import './login.spec';"),
    [NIGHTLY]: lines("import '../support/suites';"),
    'demo/shop/support/suites.ts': lines("import '../tests/login.spec';"),
  };
  const inventory = {
    ...INVENTORY,
    specs: [
      ...INVENTORY.specs,
      { file: NIGHTLY, tests: [{ title: 'nightly > runs the login suite', line: 3, tags: ['@nightly'], projects: chromium }] },
      { file: SMOKE, tests: [{ title: 'smoke > runs the login suite', line: 3, tags: ['@smoke'], projects: chromium }] },
    ],
  };
  assert.deepEqual(run(t, [changed(LOGIN)], {}, { extraFiles, inventory }), expected({
    mode: 'subset',
    totalSpecs: 5,
    totalTests: 7,
    selected: [
      login(`Spec changed: ${LOGIN}`),
      { file: NIGHTLY, testCount: 1, tags: ['@nightly'], reasons: [`${LOGIN} is imported by ${NIGHTLY} through demo/shop/support/suites.ts`] },
      { file: SMOKE, testCount: 1, tags: ['@smoke'], reasons: [`${LOGIN} is imported by ${SMOKE}`] },
    ],
    decisions: [decision(LOGIN, 'spec', 'modified', 'specs', `Spec changed: ${LOGIN}`, [LOGIN, NIGHTLY, SMOKE])],
  }));
});

// Rule 4: used by the Playwright config

test('rule 4: the helper file the config imports gives mode full', (t) => {
  const reason = 'demo/shop/support/env.ts is imported by the Playwright config';
  assert.deepEqual(run(t, [changed('demo/shop/support/env.ts')]), expected({
    mode: 'full',
    selected: everySpecFull,
    fullSuiteReasons: [reason],
    decisions: [decision('demo/shop/support/env.ts', 'test-support', 'modified', 'full', reason)],
  }));
});

// Rule 5: imported by specs

test('rule 5: cart-page.ts selects exactly the specs that import it, directly or through checkout-page', (t) => {
  const page = 'demo/shop/pages/cart-page.ts';
  assert.deepEqual(run(t, [changed(page)]), expected({
    mode: 'subset',
    selected: [
      cart(`${page} is imported by ${CART}`),
      checkout(`${page} is imported by ${CHECKOUT} through demo/shop/pages/checkout-page.ts`),
    ],
    decisions: [decision(page, 'test-support', 'modified', 'specs', 'Used by spec files: 2', [CART, CHECKOUT])],
  }));
});

test('rule 5: utils/format-price.ts, three levels away, selects every spec that reaches it', (t) => {
  const util = 'demo/shop/utils/format-price.ts';
  assert.deepEqual(run(t, [changed(util)]), expected({
    mode: 'subset',
    selected: [
      // Two shortest chains: through cart-page or login-page. cart-page sorts first.
      cart(`${util} is imported by ${CART} through demo/shop/pages/cart-page.ts -> demo/shop/pages/base-page.ts`),
      checkout(`${util} is imported by ${CHECKOUT} through demo/shop/pages/checkout-page.ts -> demo/shop/pages/base-page.ts`),
      login(`${util} is imported by ${LOGIN} through demo/shop/pages/login-page.ts -> demo/shop/pages/base-page.ts`),
    ],
    decisions: [decision(util, 'app-source', 'modified', 'specs', 'Used by spec files: 3', [CART, CHECKOUT, LOGIN])],
  }));
});

test('rule 5: a file imported by one spec selects only that spec', (t) => {
  const page = 'demo/shop/pages/checkout-page.ts';
  assert.deepEqual(run(t, [changed(page)]), expected({
    mode: 'subset',
    selected: [checkout(`${page} is imported by ${CHECKOUT}`)],
    decisions: [decision(page, 'test-support', 'modified', 'specs', 'Used by spec files: 1', [CHECKOUT])],
  }));
});

test('rule 5: when two shortest chains exist, the one that sorts first is named', (t) => {
  // cart.spec.ts reaches base-page.ts through cart-page.ts and through login-page.ts, both one step.
  // checkout.spec.ts has one shortest chain (checkout-page.ts); the longer one through cart-page.ts is not used.
  const page = 'demo/shop/pages/base-page.ts';
  assert.deepEqual(run(t, [changed(page)]), expected({
    mode: 'subset',
    selected: [
      cart(`${page} is imported by ${CART} through demo/shop/pages/cart-page.ts`),
      checkout(`${page} is imported by ${CHECKOUT} through demo/shop/pages/checkout-page.ts`),
      login(`${page} is imported by ${LOGIN} through demo/shop/pages/login-page.ts`),
    ],
    decisions: [decision(page, 'test-support', 'modified', 'specs', 'Used by spec files: 3', [CART, CHECKOUT, LOGIN])],
  }));
});

test('rule 5: a fixtures file a spec imports uses the graph, not its class', (t) => {
  const fixture = 'demo/shop/fixtures/users.ts';
  assert.deepEqual(run(t, [changed(fixture)]), expected({
    mode: 'subset',
    selected: [login(`${fixture} is imported by ${LOGIN}`)],
    decisions: [decision(fixture, 'test-data', 'modified', 'specs', 'Used by spec files: 1', [LOGIN])],
  }));
});

test('rule 5 with texts: a new page method no importer calls adds one unused-member suggestion and changes nothing else', (t) => {
  const page = 'demo/shop/pages/cart-page.ts';
  const pageText = lines(
    "import { BasePage } from './base-page';",
    '',
    'export class CartPage extends BasePage {',
    "  async open() { await this.page.goto('/cart.html'); }",
    "  async clear() { await this.page.getByTestId('remove').click(); }",
    '}',
  );
  // Every file that reaches cart-page.ts, from the graph in the comment at the top.
  const importers = ['demo/shop/pages/checkout-page.ts', CART, CHECKOUT];
  const texts = new Map([[page, pageText], ...importers.map((file) => [file, SHOP_FILES[file]])]);
  const file = { ...changed(page), ranges: [{ start: 5, end: 5 }] };
  const withTexts = run(t, [file], {}, { texts });
  assert.deepEqual(withTexts.suggestions, [{
    file: page,
    kind: 'unused-member',
    reason: 'clear was added or changed here, and no file that imports this one uses it.',
    idea: 'Add a test that calls clear.',
  }]);
  assert.deepEqual({ ...withTexts, suggestions: [] }, run(t, [file]));
});

// Rule 6: deleted support file

test('rule 6: a deleted page gives mode full', (t) => {
  const page = 'demo/shop/pages/old-page.ts';
  const reason = `Deleted or renamed support file, importers cannot be checked: ${page}`;
  assert.deepEqual(run(t, [changed(page, 'deleted')]), expected({
    mode: 'full',
    selected: everySpecFull,
    fullSuiteReasons: [reason],
    decisions: [decision(page, 'test-support', 'deleted', 'full', reason)],
  }));
});

test('rule 6: a renamed page whose new path a spec imports does not give full from the old path', (t) => {
  const page = 'demo/shop/pages/cart-page.ts';
  const oldPath = 'demo/shop/pages/basket-page.ts';
  assert.deepEqual(run(t, [changed(page, 'renamed', oldPath)]), expected({
    mode: 'subset',
    selected: [
      cart(`${page} is imported by ${CART}`),
      checkout(`${page} is imported by ${CHECKOUT} through demo/shop/pages/checkout-page.ts`),
    ],
    decisions: [
      decision(oldPath, 'test-support', 'deleted', 'none', `No spec imports ${oldPath}`),
      decision(page, 'test-support', 'renamed', 'specs', 'Used by spec files: 2', [CART, CHECKOUT]),
    ],
  }));
});

test('rule 6: a renamed page with no importers gives full from the old path', (t) => {
  const page = 'demo/shop/pages/promo-page.ts';
  const oldPath = 'demo/shop/pages/sale-page.ts';
  const reason = `Deleted or renamed support file, importers cannot be checked: ${oldPath}`;
  assert.deepEqual(run(t, [changed(page, 'renamed', oldPath)]), expected({
    mode: 'full',
    selected: everySpecFull,
    fullSuiteReasons: [reason],
    decisions: [
      decision(page, 'test-support', 'renamed', 'none', `No spec imports ${page}`),
      decision(oldPath, 'test-support', 'deleted', 'full', reason),
    ],
    suggestions: [unimported(page)],
  }));
});

// Rule 7: spec class outside the inventory

test('rule 7: a deleted spec gives none with the deleted reason', (t) => {
  const spec = 'demo/shop/tests/wishlist.spec.ts';
  assert.deepEqual(run(t, [changed(spec, 'deleted')]), expected({
    mode: 'none',
    decisions: [decision(spec, 'spec', 'deleted', 'none', `Spec deleted, nothing to run: ${spec}`)],
  }));
});

test('rule 7: a renamed spec whose new path is not in the inventory either gives two none decisions, and no deleted reason', (t) => {
  const oldPath = 'demo/shop/tests/order.spec.ts';
  const newPath = 'demo/shop/tests/basket.spec.ts';
  assert.deepEqual(run(t, [changed(newPath, 'renamed', oldPath)]), expected({
    mode: 'none',
    decisions: [
      decision(newPath, 'spec', 'renamed', 'none', `Not in the Playwright inventory: ${newPath}`),
      decision(oldPath, 'spec', 'deleted', 'none', `Spec renamed: ${oldPath} to ${newPath}`),
    ],
  }));
});

test('rule 7: a spec file that is not in the inventory gives none', (t) => {
  const spec = 'demo/shop/tests/draft.spec.ts';
  assert.deepEqual(run(t, [changed(spec, 'added')]), expected({
    mode: 'none',
    decisions: [decision(spec, 'spec', 'added', 'none', `Not in the Playwright inventory: ${spec}`)],
  }));
});

// Rule 8: unreached support code

test('rule 8: pages/promo-page.ts, which no spec imports, gives none', (t) => {
  const page = 'demo/shop/pages/promo-page.ts';
  assert.deepEqual(run(t, [changed(page)]), expected({
    mode: 'none',
    decisions: [decision(page, 'test-support', 'modified', 'none', `No spec imports ${page}`)],
    suggestions: [unimported(page)],
  }));
});

test('rule 8: fixtures/users.json is not a script, so it skips rule 8 and gives full by rule 11', (t) => {
  const data = 'demo/shop/fixtures/users.json';
  const reason = `No rule maps ${data} (test-data) to a test`;
  assert.deepEqual(run(t, [changed(data)]), expected({
    mode: 'full',
    selected: everySpecFull,
    fullSuiteReasons: [reason],
    decisions: [decision(data, 'test-data', 'modified', 'full', reason)],
  }));
});

// Rule 9: areas

test('rule 9: an area glob picks the specs with its tag', (t) => {
  const file = 'src/cart/total.ts';
  assert.deepEqual(run(t, [changed(file)], { areas: [{ glob: 'src/cart/**', tags: ['@cart'] }] }), expected({
    mode: 'subset',
    selected: [cart(`${file} matches area "src/cart/**" (tag @cart)`)],
    decisions: [decision(file, 'app-source', 'modified', 'specs', 'Matches area "src/cart/**"', [CART])],
  }));
});

test('rule 9: two matching areas union their tags', (t) => {
  const file = 'src/cart/total.ts';
  const areas = [{ glob: 'src/**/*.ts', tags: ['@checkout'] }, { glob: 'src/cart/**', tags: ['@cart'] }];
  assert.deepEqual(run(t, [changed(file)], { areas }), expected({
    mode: 'subset',
    selected: [
      cart(`${file} matches area "src/cart/**" (tag @cart)`),
      checkout(`${file} matches area "src/**/*.ts" (tag @checkout)`),
    ],
    decisions: [decision(file, 'app-source', 'modified', 'specs', 'Matches area "src/**/*.ts"', [CART, CHECKOUT])],
  }));
});

test('rule 9: an area whose tags no test has gives full', (t) => {
  const file = 'src/promo/banner.ts';
  const reason = `${file} matches area "src/promo/**" but no test has tag @promo`;
  assert.deepEqual(run(t, [changed(file)], { areas: [{ glob: 'src/promo/**', tags: ['@promo', '@sale'] }] }), expected({
    mode: 'full',
    selected: everySpecFull,
    fullSuiteReasons: [reason],
    decisions: [decision(file, 'app-source', 'modified', 'full', reason)],
    suggestions: [{
      file,
      kind: 'untagged-area',
      reason: 'Area "src/promo/**" matches this file, but no test has tag @promo.',
      idea: `Add a test tagged @promo that covers ${file}.`,
    }],
  }));
});

// Rule 10: docs

test('rule 10: README.md gives none with the docs reason', (t) => {
  assert.deepEqual(run(t, [changed('README.md')]), expected({
    mode: 'none',
    decisions: [decision('README.md', 'docs', 'modified', 'none', 'Documentation only: README.md')],
  }));
});

test('rule 10: a docs-only diff gives mode none and an empty selection', (t) => {
  assert.deepEqual(run(t, [changed('docs/guide.md', 'added'), changed('README.md')]), expected({
    mode: 'none',
    decisions: [
      decision('README.md', 'docs', 'modified', 'none', 'Documentation only: README.md'),
      decision('docs/guide.md', 'docs', 'added', 'none', 'Documentation only: docs/guide.md'),
    ],
  }));
});

// Rule 11: unmapped

for (const [file, fileClass] of [['src/new-service.ts', 'app-source'], ['.nvmrc', 'other']]) {
  test(`rule 11: ${file} gives full with No rule maps`, (t) => {
    const reason = `No rule maps ${file} (${fileClass}) to a test`;
    assert.deepEqual(run(t, [changed(file, file === '.nvmrc' ? 'modified' : 'added')]), expected({
      mode: 'full',
      selected: everySpecFull,
      fullSuiteReasons: [reason],
      decisions: [decision(file, fileClass, file === '.nvmrc' ? 'modified' : 'added', 'full', reason)],
      // Only app-source and test-support files get the unmapped-file suggestion.
      suggestions: fileClass === 'app-source' ? [unmapped(file)] : [],
    }));
  });
}

// Mixes

test('mix: a docs file plus the cart page selects the cart page specs', (t) => {
  const page = 'demo/shop/pages/cart-page.ts';
  assert.deepEqual(run(t, [changed(page), changed('README.md')]), expected({
    mode: 'subset',
    selected: [
      cart(`${page} is imported by ${CART}`),
      checkout(`${page} is imported by ${CHECKOUT} through demo/shop/pages/checkout-page.ts`),
    ],
    decisions: [
      decision('README.md', 'docs', 'modified', 'none', 'Documentation only: README.md'),
      decision(page, 'test-support', 'modified', 'specs', 'Used by spec files: 2', [CART, CHECKOUT]),
    ],
  }));
});

test('mix: a docs file plus a lockfile gives full', (t) => {
  assert.deepEqual(run(t, [changed('README.md'), changed('package-lock.json')]), expected({
    mode: 'full',
    selected: everySpecFull,
    fullSuiteReasons: ['Lockfile changed: package-lock.json'],
    decisions: [
      decision('README.md', 'docs', 'modified', 'none', 'Documentation only: README.md'),
      decision('package-lock.json', 'lockfile', 'modified', 'full', 'Lockfile changed: package-lock.json'),
    ],
  }));
});

test('mix: in mode full every spec is listed, rule reasons sorted, and Part of the full suite run comes last', (t) => {
  const page = 'demo/shop/pages/cart-page.ts';
  const selection = run(t, [changed(page), changed(LOGIN), changed('package-lock.json'), changed('src/new-service.ts', 'added')]);
  assert.deepEqual(selection, expected({
    mode: 'full',
    selected: [
      cart(`${page} is imported by ${CART}`, FULL_RUN),
      checkout(`${page} is imported by ${CHECKOUT} through demo/shop/pages/checkout-page.ts`, FULL_RUN),
      login(`Spec changed: ${LOGIN}`, FULL_RUN),
    ],
    fullSuiteReasons: ['Lockfile changed: package-lock.json', 'No rule maps src/new-service.ts (app-source) to a test'],
    decisions: [
      decision(page, 'test-support', 'modified', 'specs', 'Used by spec files: 2', [CART, CHECKOUT]),
      decision(LOGIN, 'spec', 'modified', 'specs', `Spec changed: ${LOGIN}`, [LOGIN]),
      decision('package-lock.json', 'lockfile', 'modified', 'full', 'Lockfile changed: package-lock.json'),
      decision('src/new-service.ts', 'app-source', 'added', 'full', 'No rule maps src/new-service.ts (app-source) to a test'),
    ],
    suggestions: [unmapped('src/new-service.ts')],
  }));
  for (const spec of selection.selected) assert.equal(spec.reasons.at(-1), FULL_RUN);
});

test('mix: an empty file list gives mode none', (t) => {
  assert.deepEqual(run(t, []), expected({ mode: 'none', decisions: [] }));
});

test('a path that is both a rename source and a new file gives two decisions, sorted by status', (t) => {
  assert.deepEqual(run(t, [changed('docs/new.md', 'renamed', 'docs/old.md'), changed('docs/old.md', 'added')]), expected({
    mode: 'none',
    decisions: [
      decision('docs/new.md', 'docs', 'renamed', 'none', 'Documentation only: docs/new.md'),
      decision('docs/old.md', 'docs', 'added', 'none', 'Documentation only: docs/old.md'),
      decision('docs/old.md', 'docs', 'deleted', 'none', 'Documentation only: docs/old.md'),
    ],
  }));
});

test('warnings from the graph are copied, sorted', (t) => {
  const extraFiles = {
    [CHECKOUT]: lines("import { CheckoutPage } from '../pages/checkout-page';", "import '../pages/missing-page';"),
    [CART]: lines("import { CartPage } from '../pages/cart-page';", "import '../pages/gone-page';"),
  };
  assert.deepEqual(run(t, [changed('README.md')], {}, { extraFiles }), expected({
    mode: 'none',
    decisions: [decision('README.md', 'docs', 'modified', 'none', 'Documentation only: README.md')],
    warnings: [
      `Unresolved import "../pages/gone-page" in ${CART}`,
      `Unresolved import "../pages/missing-page" in ${CHECKOUT}`,
    ],
  }));
});

// Determinism

test('the same files in a different order give the same Selection and the same JSON', (t) => {
  const files = [
    changed('demo/shop/pages/cart-page.ts'),
    changed('README.md'),
    changed(LOGIN),
    changed('demo/shop/pages/promo-page.ts', 'renamed', 'demo/shop/pages/sale-page.ts'),
    changed('src/new-service.ts', 'added'),
  ];
  const first = run(t, files);
  const second = run(t, [...files].reverse());
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(Object.keys(first), [
    'schemaVersion', 'source', 'mode', 'playwrightDir', 'totalSpecs', 'totalTests',
    'selected', 'fullSuiteReasons', 'decisions', 'warnings', 'suggestions',
  ]);
  assert.deepEqual(Object.keys(first.selected[0]), ['file', 'testCount', 'tags', 'reasons']);
  assert.deepEqual(Object.keys(first.decisions[0]), ['path', 'fileClass', 'status', 'outcome', 'reason', 'specs']);
});
