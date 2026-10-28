import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonReport, RunError } from '../dist/run/index.js';
import { parsePlaywrightList } from '../dist/inventory/index.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'results', name), 'utf8'));
const ESC = String.fromCodePoint(0x1b);

/** durationMs is a real measurement: it is checked only as a number of 0 or more, then left out. */
function withoutDurations(tests) {
  return tests.map(({ durationMs, ...rest }) => {
    assert.ok(Number.isInteger(durationMs) && durationMs >= 0, `durationMs ${durationMs}`);
    return rest;
  });
}

function throwsRunError(fn, message) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof RunError, `expected RunError, got ${error}`);
    assert.equal(error.message, message);
    return true;
  });
}

// Written by hand from demo/saucedemo/tests/cart/cart.spec.ts: the describe title and tag, each test title,
// the line of each test() call, and the one project in demo/saucedemo/playwright.config.ts.
const DEMO_CART_TESTS = [
  {
    file: 'demo/saucedemo/tests/cart/cart.spec.ts', line: 12, title: 'cart > adds a product to the cart',
    project: 'chromium', tags: ['@cart'], status: 'passed', attempts: 1, error: null,
  },
  {
    file: 'demo/saucedemo/tests/cart/cart.spec.ts', line: 24, title: 'cart > removes a product from the cart',
    project: 'chromium', tags: ['@cart'], status: 'passed', attempts: 1, error: null,
  },
];

// Written by hand from the synthetic project sources in tests/fixtures/results/README.md: retries 1, the
// smoke project runs only @cart tests, the matcher line of a failing toBe(), the timeout set to 500 ms.
const CART = 'demo/shop/tests/cart/cart.spec.ts';
const CHECKOUT = 'demo/shop/tests/checkout/checkout.spec.ts';
const TO_BE = 'Error: expect(received).toBe(expected) // Object.is equality';
const SYNTHETIC_TESTS = [
  { file: CART, line: 4, title: 'cart > adds a backpack to the cart', project: 'desktop', tags: ['@cart'], status: 'passed', attempts: 1, error: null },
  { file: CART, line: 4, title: 'cart > adds a backpack to the cart', project: 'smoke', tags: ['@cart'], status: 'passed', attempts: 1, error: null },
  { file: CART, line: 9, title: 'cart > shows the badge after a retry', project: 'desktop', tags: [], status: 'flaky', attempts: 2, error: TO_BE },
  { file: CART, line: 13, title: 'cart > applies a promo code', project: 'desktop', tags: [], status: 'skipped', attempts: 1, error: null },
  { file: CART, line: 17, title: 'cart > sells the onesie for free', project: 'desktop', tags: [], status: 'passed', attempts: 1, error: null },
  { file: CHECKOUT, line: 4, title: 'checkout > counts the items in the cart', project: 'desktop', tags: [], status: 'failed', attempts: 2, error: TO_BE },
  { file: CHECKOUT, line: 9, title: 'checkout > waits for the payment page', project: 'desktop', tags: [], status: 'timedOut', attempts: 2, error: 'Test timeout of 500ms exceeded.' },
];

test('demo-cart.json gives the two cart tests, passed, with no errors', () => {
  const parsed = parseJsonReport(fixture('demo-cart.json'), '/repo');
  assert.deepEqual(withoutDurations(parsed.tests), DEMO_CART_TESTS);
  assert.deepEqual(parsed.errors, []);
  assert.ok(Number.isInteger(parsed.durationMs) && parsed.durationMs >= 0);
});

test('synthetic-mixed.json gives every status, written by hand from the spec sources', () => {
  const parsed = parseJsonReport(fixture('synthetic-mixed.json'), '/project');
  assert.deepEqual(withoutDurations(parsed.tests), SYNTHETIC_TESTS);
  assert.deepEqual(parsed.errors, []);
  assert.ok(Number.isInteger(parsed.durationMs) && parsed.durationMs >= 0);
});

test('the recorded failures hold the values of the assertions written in the specs', () => {
  const raw = fixture('synthetic-mixed.json');
  const plain = (text) => text.replaceAll(new RegExp(`${ESC}\\[\\d+m`, 'g'), '');
  const describe = (file) => raw.suites.find((suite) => suite.file === file).suites[0];
  // checkout.spec.ts line 6: expect(cartCount).toBe(2) with cartCount 1, on both attempts.
  for (const result of describe('checkout/checkout.spec.ts').specs[0].tests[0].results) {
    assert.ok(plain(result.error.message).includes('\n\nExpected: 2\nReceived: 1'), result.error.message);
  }
  // cart.spec.ts line 10: expect(testInfo.retry).toBe(1) fails on the first attempt only.
  const flaky = describe('cart/cart.spec.ts').specs[1].tests[0].results;
  assert.ok(plain(flaky[0].error.message).includes('\n\nExpected: 1\nReceived: 0'), flaky[0].error.message);
  assert.equal(flaky[1].error, undefined);
});

test('the flaky test has two attempts, the timed out test is timedOut and test.fail() is passed', () => {
  const tests = parseJsonReport(fixture('synthetic-mixed.json'), '/project').tests;
  const byTitle = (title) => tests.find((t) => t.title === title && t.project === 'desktop');
  assert.deepEqual([byTitle('cart > shows the badge after a retry').status, byTitle('cart > shows the badge after a retry').attempts], ['flaky', 2]);
  assert.equal(byTitle('checkout > waits for the payment page').status, 'timedOut');
  assert.deepEqual([byTitle('cart > sells the onesie for free').status, byTitle('cart > sells the onesie for free').error], ['passed', null]);
  assert.equal(byTitle('cart > applies a promo code').error, null);
});

test('the same test in two projects gives two entries, and the output is sorted', () => {
  const tests = parseJsonReport(fixture('synthetic-mixed.json'), '/project').tests;
  assert.deepEqual(tests.filter((t) => t.line === 4 && t.file === CART).map((t) => t.project), ['desktop', 'smoke']);
  const keys = tests.map((t) => [t.file, String(t.line).padStart(6, '0'), t.title, t.project].join('\n'));
  assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
});

test('top-level-error.json gives no tests and one error that starts with the repo-relative file and line', () => {
  const parsed = parseJsonReport(fixture('top-level-error.json'), '/project');
  assert.deepEqual(parsed.tests, []);
  assert.deepEqual(parsed.errors, ['demo/shop/tests/inventory/inventory.spec.ts:3: Error: inventory data file is missing']);
});

// Small reports in the real shape (see the comment at the top of src/run/parse.ts).
const ROOT = '/repo';
const report = (specs, errors = [], suites = undefined) => ({
  config: { rootDir: '/repo/demo/shop/tests' },
  suites: [{ title: 'cart/cart.spec.ts', file: 'cart/cart.spec.ts', line: 0, column: 0, specs, ...(suites ? { suites } : {}) }],
  errors,
  stats: { startTime: '2026-10-28T00:00:00.000Z', duration: 12.5, expected: 0, skipped: 0, unexpected: 0, flaky: 0 },
});
const result = (status, retry, message) => ({
  workerIndex: 0, parallelIndex: 0, status, duration: 3, ...(message === undefined ? {} : { error: { message } }),
  errors: message === undefined ? [] : [{ message }], stdout: [], stderr: [], retry, startTime: '2026-10-28T00:00:00.000Z',
  annotations: [], attachments: [],
});
const spec = (title, line, outcome, results, tags = [], file = 'cart/cart.spec.ts') => ({
  title, ok: true, tags, file, line, column: 3, id: 'x',
  tests: [{ timeout: 30000, annotations: [], expectedStatus: 'passed', projectId: 'desktop', projectName: 'desktop', results, status: outcome }],
});
const only = (json) => parseJsonReport(json, ROOT).tests[0];

test('ANSI color codes are removed from an error line', () => {
  const message = `Error: ${ESC}[2mexpect(${ESC}[22m${ESC}[31mreceived${ESC}[39m${ESC}[2m).${ESC}[22mtoBe${ESC}[2m(${ESC}[22m${ESC}[32mexpected${ESC}[39m${ESC}[2m)${ESC}[22m\n\nExpected: 2`;
  assert.equal(only(report([spec('counts the items', 4, 'unexpected', [result('failed', 0, message)])])).error,
    'Error: expect(received).toBe(expected)');
});

test('a long error line is cut at 200 characters (ERROR_LINE_MAX) and ends in ...', () => {
  const long = `Error: ${'x'.repeat(300)}`;
  const error = only(report([spec('counts the items', 4, 'unexpected', [result('failed', 0, long)])])).error;
  assert.equal(error, `Error: ${'x'.repeat(193)}...`);
  const exact = `Error: ${'x'.repeat(193)}`;
  assert.equal(only(report([spec('counts the items', 4, 'unexpected', [result('failed', 0, exact)])])).error, exact);
});

test('the absolute root inside a message becomes a repo-relative path, and blank lines are skipped', () => {
  const message = '\n  \nError: /repo/demo/shop/pages/cart-page.ts: the cart badge is missing\nsecond line';
  assert.equal(only(report([spec('counts the items', 4, 'unexpected', [result('failed', 0, message)])])).error,
    'Error: demo/shop/pages/cart-page.ts: the cart badge is missing');
});

test('a test whose only result is interrupted is interrupted, not skipped', () => {
  assert.deepEqual(withoutDurations([only(report([spec('checks out', 4, 'skipped', [result('interrupted', 0)])]))]), [{
    file: 'demo/shop/tests/cart/cart.spec.ts', line: 4, title: 'checks out', project: 'desktop', tags: [],
    status: 'interrupted', attempts: 1, error: null,
  }]);
});

test('a failed attempt then an interrupted retry is interrupted, with the error of the failed attempt', () => {
  const test1 = only(report([spec('checks out', 4, 'unexpected', [result('failed', 0, 'Error: the total is wrong'), result('interrupted', 1)])]));
  assert.deepEqual([test1.status, test1.attempts, test1.error], ['interrupted', 2, 'Error: the total is wrong']);
});

test('a test with no results is skipped with no attempts', () => {
  const test1 = only(report([spec('checks out', 4, 'skipped', [])]));
  assert.deepEqual([test1.status, test1.attempts, test1.error], ['skipped', 0, null]);
});

test('tags get the @ back and are sorted', () => {
  assert.deepEqual(only(report([spec('checks out', 4, 'expected', [result('passed', 0)], ['smoke', 'cart'])])).tags, ['@cart', '@smoke']);
});

test('nested and anonymous describe blocks give the same titles as the inventory', () => {
  const nested = [
    { title: 'cart', file: 'cart/cart.spec.ts', line: 3, column: 6, specs: [], suites: [
      { title: 'badge', file: 'cart/cart.spec.ts', line: 4, column: 8, specs: [spec('shows one item', 5, 'expected', [result('passed', 0)])] },
      { title: '', file: 'cart/cart.spec.ts', line: 7, column: 8, specs: [spec('opens the cart', 8, 'expected', [result('passed', 0)])] },
    ] },
  ];
  const json = report([spec('top level test', 2, 'expected', [result('passed', 0)])], [], nested);
  const titles = parseJsonReport(json, ROOT).tests.map((t) => t.title);
  assert.deepEqual(titles, ['top level test', 'cart > badge > shows one item', 'cart > opens the cart']);
  const inventory = parsePlaywrightList(json, ROOT, 'demo/shop');
  assert.deepEqual(inventory.specs[0].tests.map((t) => t.title), titles);
});

test('a top-level error that already names its file gets no prefix', () => {
  const error = {
    message: 'SyntaxError: /repo/demo/shop/tests/broken.spec.ts: Unexpected token (3:0)',
    location: { file: '/repo/demo/shop/tests/broken.spec.ts', line: 3, column: 0 },
  };
  assert.deepEqual(parseJsonReport(report([], [error]), ROOT).errors, ['SyntaxError: demo/shop/tests/broken.spec.ts: Unexpected token (3:0)']);
});

test('a top-level error located outside the root, or with no location, gets no prefix', () => {
  const errors = [
    { message: 'Error: global setup failed', location: { file: '/elsewhere/setup.ts', line: 1, column: 1 } },
    { message: `${ESC}[31mTimed out waiting 60s for the test suite to run${ESC}[39m` },
  ];
  assert.deepEqual(parseJsonReport(report([], errors), ROOT).errors, [
    'Error: global setup failed',
    'Timed out waiting 60s for the test suite to run',
  ]);
});

test('a test file outside the root throws RunError', () => {
  // rootDir is /repo/demo/shop/tests, so four steps up leave /repo.
  throwsRunError(() => parseJsonReport(report([spec('adds', 2, 'expected', [], [], '../../../../elsewhere/cart.spec.ts')]), ROOT),
    'Test file outside the root folder: ../../../../elsewhere/cart.spec.ts');
});

for (const [label, json] of [
  ['a string', 'not json'],
  ['null', null],
  ['an array', []],
  ['an object with no stats', { config: { rootDir: '/repo/tests' }, suites: [], errors: [] }],
  ['an object with no config', { suites: [], errors: [], stats: { duration: 1 } }],
  ['a list report test with an unknown status', report([spec('adds', 2, 'passed', [])])],
  ['a spec with no title', report([{ line: 1, tags: [], tests: [] }])],
  ['a result with no duration', report([spec('adds', 2, 'expected', [{ status: 'passed' }])])],
]) {
  test(`${label} is not a Playwright JSON report`, () => {
    throwsRunError(() => parseJsonReport(json, ROOT), 'The Playwright JSON report does not have the expected shape');
  });
}
