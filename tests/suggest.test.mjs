import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGitDiff } from '../dist/diff/index.js';
import { selectTests } from '../dist/impact/index.js';
import { findChangedMembers, isMemberUsed, suggestTests } from '../dist/suggest/index.js';
import { cleanup, createTempRepo } from './helpers/git-repo.mjs';

/**
 * suggestTests and its two helpers on made-up SauceDemo style inputs. Every expected value is written
 * by hand from the rules in src/suggest/suggest.ts. Pure: no files, no processes, except the one end to
 * end test at the end of the findChangedMembers part, which builds a temp git project under
 * os.tmpdir() through tests/helpers/git-repo.mjs and runs the real selection on it.
 */

const lines = (...ls) => ls.map((l) => `${l}\n`).join('');

const decision = (path, fileClass, status, outcome, reason, specs = []) => ({ path, fileClass, status, outcome, reason, specs });
const entry = (rule, d, { area = null, importers = [], ranges = [] } = {}) => ({ decision: d, rule, area, importers, ranges });
const run = (entries, texts = {}) => suggestTests({ entries, texts: new Map(Object.entries(texts)) });

const TOTAL = 'src/cart/total.ts';
const ABOUT = 'demo/shop/pages/about-page.ts';
const BANNER = 'src/promo/banner.ts';
const PAGE = 'demo/shop/pages/inventory-page.ts';
const CHECKOUT_PAGE = 'demo/shop/pages/checkout-page.ts';
const SPEC = 'demo/shop/tests/inventory.spec.ts';
const CHECKOUT_SPEC = 'demo/shop/tests/checkout.spec.ts';

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
const unusedMethod = (file, name) => ({
  file, kind: 'unused-member', reason: `${name} was added or changed here, and no file that imports this one uses it.`, idea: `Add a test that calls ${name}.`,
});
const unusedProperty = (file, name) => ({
  file, kind: 'unused-member', reason: `${name} was added or changed here, and no file that imports this one uses it.`, idea: `Add a test that uses ${name}.`,
});

// Signal 1: unmapped-file

test('unmapped-file: a rule 11 app-source file gets the full suite fallback suggestion', () => {
  const d = decision(TOTAL, 'app-source', 'added', 'full', `No rule maps ${TOTAL} (app-source) to a test`);
  assert.deepEqual(run([entry(11, d)]), [unmapped(TOTAL)]);
});

test('unmapped-file: a rule 11 test-support file that is not a script gets it too', () => {
  const file = 'demo/shop/pages/cart.css';
  const d = decision(file, 'test-support', 'modified', 'full', `No rule maps ${file} (test-support) to a test`);
  assert.deepEqual(run([entry(11, d)]), [unmapped(file)]);
});

test('unmapped-file: rule 11 test-data and other files get nothing, because data files are often read at run time', () => {
  assert.deepEqual(run([
    entry(11, decision('demo/shop/fixtures/users.json', 'test-data', 'modified', 'full', 'No rule maps demo/shop/fixtures/users.json (test-data) to a test')),
    entry(11, decision('.nvmrc', 'other', 'modified', 'full', 'No rule maps .nvmrc (other) to a test')),
  ]), []);
});

test('unmapped-file covered: an app-source file that rule 5 or rule 9 maps gets nothing', () => {
  const util = 'demo/shop/utils/format-price.ts';
  assert.deepEqual(run([
    entry(5, decision(util, 'app-source', 'modified', 'specs', 'Used by spec files: 1', [SPEC]), { importers: [SPEC] }),
    entry(9, decision('src/cart/badge.ts', 'app-source', 'modified', 'specs', 'Matches area "src/cart/**"', [SPEC])),
  ]), []);
});

// Signal 2: unimported-support

test('unimported-support: a rule 8 script with status added, modified, renamed or copied gets one suggestion each', () => {
  const files = ['demo/shop/pages/a-page.ts', 'demo/shop/pages/b-page.ts', 'demo/shop/pages/c-page.ts', 'demo/shop/pages/d-page.ts'];
  const statuses = ['added', 'modified', 'renamed', 'copied'];
  const entries = files.map((file, i) => entry(8, decision(file, 'test-support', statuses[i], 'none', `No spec imports ${file}`)));
  assert.deepEqual(run(entries), files.map(unimported));
});

test('unimported-support: a rule 8 data script gets it too', () => {
  const file = 'demo/shop/fixtures/products.ts';
  assert.deepEqual(run([entry(8, decision(file, 'test-data', 'added', 'none', `No spec imports ${file}`))]), [unimported(file)]);
});

test('unimported-support covered: a support script that a spec imports gets nothing', () => {
  const d = decision(ABOUT, 'test-support', 'modified', 'specs', 'Used by spec files: 1', [SPEC]);
  // No added lines, so the member signal has nothing to read either.
  assert.deepEqual(run([entry(5, d, { importers: [SPEC] })], { [ABOUT]: 'export class AboutPage {}\n', [SPEC]: '' }), []);
});

// Signal 3: untagged-area

test('untagged-area: a rule 9 full outcome names the area glob and its first tag', () => {
  const reason = `${BANNER} matches area "src/promo/**" but no test has tag @promo`;
  const d = decision(BANNER, 'app-source', 'modified', 'full', reason);
  assert.deepEqual(run([entry(9, d, { area: { glob: 'src/promo/**', tag: '@promo' } })]), [{
    file: BANNER,
    kind: 'untagged-area',
    reason: 'Area "src/promo/**" matches this file, but no test has tag @promo.',
    idea: `Add a test tagged @promo that covers ${BANNER}.`,
  }]);
});

test('untagged-area covered: a rule 9 area whose tag a test has picks specs and gets nothing', () => {
  const d = decision('src/cart/total.ts', 'app-source', 'modified', 'specs', 'Matches area "src/cart/**"', [SPEC]);
  assert.deepEqual(run([entry(9, d, { area: { glob: 'src/cart/**', tag: '@cart' } })]), []);
});

// Signal 4: unused-member

const INVENTORY_PAGE = lines(
  "import type { Locator, Page } from '@playwright/test';",   // 1
  '',                                                         // 2
  'export class InventoryPage {',                             // 3
  '  readonly page: Page;',                                   // 4
  '  readonly sort: Locator;',                                // 5
  '  readonly aboutLink: Locator;',                           // 6
  '',                                                         // 7
  '  constructor(page: Page) {',                              // 8
  '    this.page = page;',                                    // 9
  "    this.sort = page.getByTestId('product-sort-container');", // 10
  "    this.aboutLink = page.getByTestId('about-sidebar-link');", // 11
  '  }',                                                      // 12
  '',                                                         // 13
  '  async sortBy(value: string) {',                          // 14
  '    await this.sort.selectOption(value);',                 // 15
  '  }',                                                      // 16
  '',                                                         // 17
  '  async resetSort() {',                                    // 18
  "    await this.sortBy('az');",                             // 19
  '  }',                                                      // 20
  '}',                                                        // 21
);
// The lines a change adds: aboutLink, its constructor line, and resetSort.
const ADDED = [{ start: 6, end: 6 }, { start: 11, end: 11 }, { start: 17, end: 20 }];
const specText = (...body) => lines(
  "import { expect, test } from '@playwright/test';",
  "import { InventoryPage } from '../pages/inventory-page';",
  '',
  "test.describe('inventory', { tag: '@inventory' }, () => {",
  "  test('sorts the products', async ({ page }) => {",
  '    const inventoryPage = new InventoryPage(page);',
  ...body,
  '  });',
  '});',
);
const pageEntry = (ranges = ADDED, importers = [SPEC]) =>
  entry(5, decision(PAGE, 'test-support', 'modified', 'specs', `Used by spec files: ${importers.length}`, [SPEC]), { importers, ranges });

test('unused-member: a new method and a new property that no importer uses give one suggestion each', () => {
  const texts = { [PAGE]: INVENTORY_PAGE, [SPEC]: specText("    await inventoryPage.sortBy('za');") };
  assert.deepEqual(run([pageEntry()], texts), [unusedProperty(PAGE, 'aboutLink'), unusedMethod(PAGE, 'resetSort')]);
});

test('unused-member covered: every changed member is used by the spec, so nothing is suggested', () => {
  const texts = {
    [PAGE]: INVENTORY_PAGE,
    [SPEC]: specText('    await inventoryPage.resetSort();', '    await expect(inventoryPage.aboutLink).toBeVisible();'),
  };
  assert.deepEqual(run([pageEntry()], texts), []);
});

test('unused-member covered: a use in a file between the spec and the page counts', () => {
  const checkoutPage = lines(
    "import { InventoryPage } from './inventory-page';",
    'export class CheckoutPage {',
    '  async restart(inventoryPage: InventoryPage) {',
    '    await inventoryPage.resetSort();',
    '    await inventoryPage.aboutLink.click();',
    '  }',
    '}',
  );
  const texts = { [PAGE]: INVENTORY_PAGE, [CHECKOUT_PAGE]: checkoutPage, [CHECKOUT_SPEC]: '' };
  assert.deepEqual(run([pageEntry(ADDED, [CHECKOUT_PAGE, CHECKOUT_SPEC])], texts), []);
});

test('unused-member covered: a use elsewhere in the file itself counts', () => {
  // sortBy is declared on line 14 and called by resetSort on line 19.
  const texts = { [PAGE]: INVENTORY_PAGE, [SPEC]: specText() };
  assert.deepEqual(run([pageEntry([{ start: 14, end: 16 }])], texts), []);
});

test('unused-member: a use only on the declaring line does not count', () => {
  // resetSort( appears on line 18 only, the line that declares it.
  const texts = { [PAGE]: INVENTORY_PAGE, [SPEC]: specText() };
  assert.deepEqual(run([pageEntry([{ start: 18, end: 20 }])], texts), [unusedMethod(PAGE, 'resetSort')]);
});

test('unused-member: the constructor assignment of a property is not a use', () => {
  // Line 11, this.aboutLink = ..., is the only other place that names aboutLink.
  const texts = { [PAGE]: INVENTORY_PAGE, [SPEC]: specText() };
  assert.deepEqual(run([pageEntry([{ start: 6, end: 6 }])], texts), [unusedProperty(PAGE, 'aboutLink')]);
});

test('unused-member: a missing page text or a missing importer text gives nothing and no error', () => {
  assert.deepEqual(run([pageEntry()], { [SPEC]: specText() }), []);
  assert.deepEqual(run([pageEntry()], { [PAGE]: INVENTORY_PAGE }), []);
});

test('unused-member: only test-support files are read; app-source and test-data rule 5 files get nothing', () => {
  const util = 'demo/shop/utils/sort.ts';
  const data = 'demo/shop/fixtures/sorts.ts';
  const text = lines('export function sortNames(names: string[]) {', '  return [...names].sort();', '}');
  const texts = { [util]: text, [data]: text, [SPEC]: specText() };
  assert.deepEqual(run([
    entry(5, decision(util, 'app-source', 'modified', 'specs', 'Used by spec files: 1', [SPEC]), { importers: [SPEC], ranges: [{ start: 1, end: 3 }] }),
    entry(5, decision(data, 'test-data', 'modified', 'specs', 'Used by spec files: 1', [SPEC]), { importers: [SPEC], ranges: [{ start: 1, end: 3 }] }),
  ], texts), []);
});

test('unused-member: an exported function no importer calls gets the calls idea', () => {
  const helper = 'demo/shop/helpers/sort-helper.ts';
  const text = lines('export function sortNames(names: string[]) {', '  return [...names].sort();', '}');
  const d = decision(helper, 'test-support', 'added', 'specs', 'Used by spec files: 1', [SPEC]);
  assert.deepEqual(run([entry(5, d, { importers: [SPEC], ranges: [{ start: 1, end: 3 }] })], { [helper]: text, [SPEC]: specText() }), [
    unusedMethod(helper, 'sortNames'),
  ]);
});

// Paths that never get a suggestion

test('deleted paths, the old path of a rename, ignored files, full suite triggers, docs and specs give nothing', () => {
  const page = 'demo/shop/pages/old-page.ts';
  assert.deepEqual(run([
    entry(11, decision('src/old.ts', 'app-source', 'deleted', 'full', 'No rule maps src/old.ts (app-source) to a test')),
    // The old path of a renamed page that no spec imports: rule 8, status deleted.
    entry(8, decision(page, 'test-support', 'deleted', 'none', `No spec imports ${page}`)),
    entry(9, decision(BANNER, 'app-source', 'deleted', 'full', 'x'), { area: { glob: 'src/promo/**', tag: '@promo' } }),
    entry(6, decision(page, 'test-support', 'deleted', 'full', `Deleted or renamed support file, importers cannot be checked: ${page}`)),
    entry(1, decision('src/ignored.ts', 'app-source', 'modified', 'ignored', 'Ignored by pattern "src/ignored.ts"')),
    entry(2, decision('src/config.ts', 'app-source', 'modified', 'full', 'src/config.ts matches fullSuiteOn pattern "src/config.ts"')),
    entry(2, decision('package.json', 'package-manifest', 'modified', 'full', 'Package manifest changed: package.json')),
    entry(4, decision('demo/shop/support/env.ts', 'test-support', 'modified', 'full', 'demo/shop/support/env.ts is imported by the Playwright config')),
    entry(10, decision('README.md', 'docs', 'modified', 'none', 'Documentation only: README.md')),
    entry(3, decision(SPEC, 'spec', 'modified', 'specs', `Spec changed: ${SPEC}`, [SPEC])),
    entry(7, decision('demo/shop/tests/draft.spec.ts', 'spec', 'added', 'none', 'Not in the Playwright inventory: demo/shop/tests/draft.spec.ts')),
  ]), []);
});

test('no entries give no suggestions', () => {
  assert.deepEqual(run([]), []);
});

// Sort and determinism

test('suggestions are sorted by file, then kind in the listed order, then reason', () => {
  const texts = { [PAGE]: INVENTORY_PAGE, [SPEC]: specText() };
  const entries = [
    entry(11, decision(TOTAL, 'app-source', 'added', 'full', 'x')),
    pageEntry(),
    entry(9, decision(BANNER, 'app-source', 'modified', 'full', 'x'), { area: { glob: 'src/promo/**', tag: '@promo' } }),
    entry(8, decision(ABOUT, 'test-support', 'added', 'none', 'x')),
    // Made up, to check the kind order inside one file: rule 11 and rule 8 for the same path.
    entry(8, decision(TOTAL, 'test-support', 'modified', 'none', 'x')),
  ];
  assert.deepEqual(run(entries, texts), [
    unimported(ABOUT),
    unusedProperty(PAGE, 'aboutLink'),
    unusedMethod(PAGE, 'resetSort'),
    unmapped(TOTAL),
    unimported(TOTAL),
    {
      file: BANNER,
      kind: 'untagged-area',
      reason: 'Area "src/promo/**" matches this file, but no test has tag @promo.',
      idea: `Add a test tagged @promo that covers ${BANNER}.`,
    },
  ]);
});

test('the same file, kind and reason twice gives one suggestion', () => {
  const d = decision(ABOUT, 'test-support', 'added', 'none', 'x');
  assert.deepEqual(run([entry(8, d), entry(8, d)]), [unimported(ABOUT)]);
});

test('the same input twice gives deep equal output, and the input is not changed', () => {
  const input = {
    entries: [pageEntry(), entry(11, decision(TOTAL, 'app-source', 'added', 'full', 'x'))],
    texts: new Map(Object.entries({ [PAGE]: INVENTORY_PAGE, [SPEC]: specText() })),
  };
  const copy = structuredClone(input);
  const first = suggestTests(input);
  const second = suggestTests(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(input, copy);
  assert.deepEqual(Object.keys(first[0]), ['file', 'kind', 'reason', 'idea']);
});

// findChangedMembers

const all = (text) => [{ start: 1, end: text.split('\n').length }];

test('findChangedMembers finds methods, readonly properties and exported functions', () => {
  const text = lines(
    '  readonly checkoutButton: Locator;',                        // 1
    "  readonly title = 'Your Cart';",                            // 2
    '  public readonly badge: Locator;',                          // 3
    "  static readonly PATH = '/cart.html';",                     // 4
    '  goto() {',                                                 // 5
    '  async checkout() {',                                       // 6
    '  static from(page: Page) {',                                // 7
    '  public async removeItem(name: string): Promise<void> {',   // 8
    "  async open() { await this.page.goto('/cart.html'); }",     // 9
    'export function formatPrice(value: number): string {',       // 10
    'export async function loginAs(page: Page, user: string) {',  // 11
  );
  assert.deepEqual(findChangedMembers(text, all(text)), [
    { name: 'checkoutButton', line: 1, kind: 'property' },
    { name: 'title', line: 2, kind: 'property' },
    { name: 'badge', line: 3, kind: 'property' },
    { name: 'PATH', line: 4, kind: 'property' },
    { name: 'goto', line: 5, kind: 'method' },
    { name: 'checkout', line: 6, kind: 'method' },
    { name: 'from', line: 7, kind: 'method' },
    { name: 'removeItem', line: 8, kind: 'method' },
    { name: 'open', line: 9, kind: 'method' },
    { name: 'formatPrice', line: 10, kind: 'function' },
    { name: 'loginAs', line: 11, kind: 'function' },
  ]);
});

test('findChangedMembers skips the constructor, private, protected, and names that start with _ or #', () => {
  const text = lines(
    '  constructor(page: Page) {',
    '  private readonly secret: string;',
    '  protected readonly base: string;',
    '  private async clear() {',
    '  protected reset() {',
    '  readonly _hidden: Locator;',
    '  readonly #inner: Locator;',
    '  _internal() {',
    '  #privateMethod() {',
  );
  assert.deepEqual(findChangedMembers(text, all(text)), []);
});

test('findChangedMembers skips keywords, super and lines that end in ;', () => {
  const text = lines(
    '    if(open) {',
    '    for(const item of items) {',
    '    while(busy) {',
    '    switch(kind) {',
    '    catch(error) {',
    '    return(total)',
    '    function(x) {',
    '    super(',
    '    expect(total).toBe(1);',
    '    addToCart(item);',
    '    if (open) {',
  );
  assert.deepEqual(findChangedMembers(text, all(text)), []);
});

test('findChangedMembers reads only the lines inside a range, and a range past the end is cut', () => {
  const text = lines('  goto() {', '  }', '  async checkout() {', '  }');
  assert.deepEqual(findChangedMembers(text, [{ start: 3, end: 99 }]), [{ name: 'checkout', line: 3, kind: 'method' }]);
  assert.deepEqual(findChangedMembers(text, [{ start: 2, end: 2 }]), []);
  assert.deepEqual(findChangedMembers(text, []), []);
});

test('findChangedMembers handles CRLF line endings', () => {
  assert.deepEqual(findChangedMembers('  readonly title: Locator;\r\n  async open() {\r\n', [{ start: 1, end: 2 }]), [
    { name: 'title', line: 1, kind: 'property' },
    { name: 'open', line: 2, kind: 'method' },
  ]);
});

test('findChangedMembers does not see getters, override, generic methods or arrow function exports (documented misses)', () => {
  const text = lines(
    '  get total(): number {',
    '  override async open() {',
    '  async find<T>(name: string) {',
    'export const formatPrice = (value: number): string => `$${value}`;',
    'export default function setup() {',
  );
  assert.deepEqual(findChangedMembers(text, all(text)), []);
});

test('findChangedMembers on a 100000 character line finishes', () => {
  const long = `  ${'async '.repeat(20000)}x`;
  assert.deepEqual(findChangedMembers(long, [{ start: 1, end: 1 }]), []);
  assert.deepEqual(findChangedMembers(`  ${'a'.repeat(100000)}`, [{ start: 1, end: 1 }]), []);
});

// Semicolon-free code (PR 7a): a method line opens its body with {, and an imported name is never a method.

test('findChangedMembers: semicolon-free call lines are not methods', () => {
  const text = lines(
    "  logStep('checkout')",
    '  addToCart(item)',
    '  await this.checkoutButton.click()',
    "  expect(total).toBe('1')",
  );
  assert.deepEqual(findChangedMembers(text, all(text)), []);
});

test('findChangedMembers: semicolon-free method lines that end in { are still found', () => {
  const text = lines(
    '  async itemCount() {',
    '  checkout() {',
    '  onClick(fn: () => void) {',
    '  async open(): Promise<void> {',
  );
  assert.deepEqual(findChangedMembers(text, all(text)), [
    { name: 'itemCount', line: 1, kind: 'method' },
    { name: 'checkout', line: 2, kind: 'method' },
    { name: 'onClick', line: 3, kind: 'method' },
    { name: 'open', line: 4, kind: 'method' },
  ]);
});

test('findChangedMembers: a one line method with its body on the line still gives open, with or without ;', () => {
  const text = lines(
    "  async open() { await this.page.goto('/cart.html') }",
    "  async close(): Promise<void> { await this.page.goto('/') }",
  );
  assert.deepEqual(findChangedMembers(text, all(text)), [
    { name: 'open', line: 1, kind: 'method' },
    { name: 'close', line: 2, kind: 'method' },
  ]);
});

test('findChangedMembers: a call that ends in { is skipped when the file imports the name, and is a documented miss when it does not', () => {
  const call = "  logStep('x', async () => {";
  const imported = lines("import { logStep } from '../support/log'", '', 'export class CartPage {', call);
  assert.deepEqual(findChangedMembers(imported, [{ start: 4, end: 4 }]), []);
  const notImported = lines('export class CartPage {', call);
  assert.deepEqual(findChangedMembers(notImported, [{ start: 2, end: 2 }]), [{ name: 'logStep', line: 2, kind: 'method' }]);
});

test('findChangedMembers: every import form hides the name, a name only in a comment or a string does not', () => {
  const head = lines(
    "import helper from '../support/helper'",
    "import { logStep, addToCart as add } from '../support/log'",
    "import * as steps from '../support/steps'",
    "import type { Waiter } from '../support/types'",
    "import { type Timer, retry } from '../support/retry'",
    'import {',
    '  multiLine,',
    "} from '../support/multi'",
    "// import { inComment } from '../support/comment'",
    "const text = \"import { inString } from '../support/string'\"",
  );
  const calls = ['helper', 'logStep', 'add', 'steps', 'Waiter', 'Timer', 'retry', 'multiLine', 'inComment', 'inString']
    .map((name) => `  ${name}('x', () => {`);
  const text = head + lines(...calls);
  const start = head.split('\n').length;
  assert.deepEqual(findChangedMembers(text, [{ start, end: start + calls.length - 1 }]), [
    { name: 'inComment', line: start + 8, kind: 'method' },
    { name: 'inString', line: start + 9, kind: 'method' },
  ]);
});

test('findChangedMembers: the import skip is for methods only; an imported name on a property or function line still counts', () => {
  const text = lines(
    "import { title, formatPrice } from '../support/names'",
    '  readonly title: Locator',
    'export function formatPrice(value: number): string {',
  );
  assert.deepEqual(findChangedMembers(text, [{ start: 2, end: 3 }]), [
    { name: 'title', line: 2, kind: 'property' },
    { name: 'formatPrice', line: 3, kind: 'function' },
  ]);
});

test('findChangedMembers: a signature split over lines with no { on its first line is not seen (documented miss)', () => {
  const text = lines('  async open(', '    url: string,', '  ) {', '  async close()', '  {');
  assert.deepEqual(findChangedMembers(text, all(text)), []);
});

test('findChangedMembers: a long call line with nested parentheses and { finishes', () => {
  const long = `  logStep(${'('.repeat(50000)}${')'.repeat(50000)} {`;
  assert.deepEqual(findChangedMembers(long, [{ start: 1, end: 1 }]), [{ name: 'logStep', line: 1, kind: 'method' }]);
  const open = `  open(${'a'.repeat(100000)}`;
  assert.deepEqual(findChangedMembers(open, [{ start: 1, end: 1 }]), []);
});

test('end to end with git: a semicolon-free page object with an imported logStep call and a new method gives one suggestion', { timeout: 120_000 }, async (t) => {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const repo = createTempRepo();
  t.after(() => cleanup(repo.dir));
  repo.write('.gitignore', lines('node_modules'));
  // A link to this repo's installed packages, so Playwright resolves; it is ignored, so never committed.
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(repo.dir, 'node_modules'), 'dir');
  repo.write('qa-core-prcheck.config.json', JSON.stringify({ playwrightDir: 'demo/shop' }));
  repo.write('demo/shop/playwright.config.ts', lines(
    "import { defineConfig } from '@playwright/test'",
    '',
    "export default defineConfig({ testDir: './tests' })",
  ));
  repo.write('demo/shop/support/log.ts', lines(
    'export function logStep(name: string) {',
    '  console.log(name)',
    '}',
  ));
  const cartPage = (...added) => lines(
    "import type { Page } from '@playwright/test'",
    "import { logStep } from '../support/log'",
    '',
    'export class CartPage {',
    '  constructor(readonly page: Page) {}',
    '',
    '  async checkout() {',
    ...(added.length > 0 ? ["    logStep('checkout')"] : []),
    "    await this.page.getByTestId('checkout').click()",
    '  }',
    ...added,
    '}',
  );
  repo.write('demo/shop/pages/cart-page.ts', cartPage());
  repo.write('demo/shop/tests/cart.spec.ts', lines(
    "import { test } from '@playwright/test'",
    "import { CartPage } from '../pages/cart-page'",
    '',
    "test.describe('cart', { tag: '@cart' }, () => {",
    "  test('checks out', async ({ page }) => {",
    '    await new CartPage(page).checkout()',
    '  })',
    '})',
  ));
  repo.commitAll('base');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write('demo/shop/pages/cart-page.ts', cartPage(
    '',
    '  async itemCount() {',
    "    return this.page.getByTestId('cart-item').count()",
    '  }',
  ));
  repo.commitAll('log the checkout step and add itemCount');

  const diff = await readGitDiff({ base: 'main', head: 'feature', cwd: repo.dir, env: repo.env });
  const selection = await selectTests({ root: repo.dir, diff, env: repo.env });
  assert.equal(selection.mode, 'subset');
  assert.deepEqual(selection.suggestions, [unusedMethod('demo/shop/pages/cart-page.ts', 'itemCount')]);
});

// isMemberUsed

test('isMemberUsed is true for .name(, .name) and .name.click(), and for name( called directly', () => {
  assert.equal(isMemberUsed('resetSort', ['await inventoryPage.resetSort();']), true);
  assert.equal(isMemberUsed('aboutLink', ['await expect(inventoryPage.aboutLink).toBeVisible();']), true);
  assert.equal(isMemberUsed('aboutLink', ['await inventoryPage.aboutLink.click();']), true);
  assert.equal(isMemberUsed('sortNames', ['const sorted = sortNames(names);']), true);
});

test('isMemberUsed is false for .nameOther, for the name inside a longer word, and for an assignment', () => {
  assert.equal(isMemberUsed('resetSort', ['await inventoryPage.resetSortOther();']), false);
  assert.equal(isMemberUsed('resetSort', ['await myresetSort();', 'const resetSorting = 1;']), false);
  assert.equal(isMemberUsed('aboutLink', ["this.aboutLink = page.getByTestId('about-sidebar-link');"]), false);
  assert.equal(isMemberUsed('aboutLink', ['this.aboutLink=page.locator("a");']), false);
});

test('isMemberUsed counts a comparison as a use, and looks at every text', () => {
  assert.equal(isMemberUsed('total', ['if (cart.total == 0) {}']), true);
  assert.equal(isMemberUsed('total', ['if (cart.total === 0) {}']), true);
  assert.equal(isMemberUsed('total', ['', 'nothing here', 'cart.total']), true);
  assert.equal(isMemberUsed('total', []), false);
});

test('isMemberUsed treats a $ in a name as a plain character', () => {
  assert.equal(isMemberUsed('$el', ['await page.$el.click();']), true);
  assert.equal(isMemberUsed('$el', ['await page.xel.click();']), false);
});
