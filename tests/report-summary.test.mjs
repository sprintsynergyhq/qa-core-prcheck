import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSummary, MAX_SUMMARY_BYTES, ReportError, SUMMARY_MARKER } from '../dist/report/index.js';

/**
 * formatSummary against the hand-written goldens in tests/fixtures/summary/, plus cases built from the
 * recorded inputs with one value changed. Every expected value is written by hand from the layout in
 * src/report/summary.ts. Pure: no processes, no writes.
 */

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtures = path.join(repoRoot, 'tests', 'fixtures', 'summary');
const VERSION = '0.0.0-test';
const lines = (...ls) => ls.map((l) => `${l}\n`).join('');
const bytes = (text) => Buffer.byteLength(text, 'utf8');
const DASHES = new RegExp(`[${String.fromCodePoint(0x2014)}${String.fromCodePoint(0x2013)}]`);

const inputOf = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, 'inputs', `${name}.json`), 'utf8'));
const goldenOf = (name) => fs.readFileSync(path.join(fixtures, `${name}.md`), 'utf8');
const summaryInput = (name, extra = {}) => {
  const { selection, result, error = null } = inputOf(name);
  return { selection, result, error, version: VERSION, ...extra };
};

// golden name, input name, extra input, verdict, fullSuite, truncated, omitted (counted by hand)
const CASES = [
  ['passed', 'passed', {}, 'passed', false, false, 0],
  ['failed', 'failed', {}, 'failed', false, false, 0],
  ['full-suite-run', 'full-suite-run', {}, 'failed', true, false, 0],
  ['no-tests-needed', 'no-tests-needed', {}, 'no-tests-needed', false, false, 0],
  ['not-run', 'not-run', {}, 'not-run', false, false, 0],
  ['error', 'error', {}, 'error', false, false, 0],
  ['pre-run-error', 'pre-run-error', {}, 'error', false, false, 0],
  // The Picked Specs row and the timed out Failures row are left out.
  ['truncated', 'failed', { maxBytes: 900 }, 'failed', false, true, 2],
];

for (const [golden, input, extra, verdict, fullSuite, truncated, omitted] of CASES) {
  test(`${golden}: equals ${golden}.md byte for byte`, () => {
    const summary = formatSummary(summaryInput(input, extra));
    assert.equal(summary.markdown, goldenOf(golden));
    assert.deepEqual(
      { verdict: summary.verdict, fullSuite: summary.fullSuite, truncated: summary.truncated, omitted: summary.omitted },
      { verdict, fullSuite, truncated, omitted },
    );
  });

  test(`${golden}: the marker is the first line and appears once, and the input is not changed`, () => {
    const data = summaryInput(input, extra);
    const copy = structuredClone(data);
    const { markdown } = formatSummary(data);
    assert.deepEqual(data, copy);
    assert.equal(markdown.split('\n')[0], SUMMARY_MARKER);
    assert.equal(markdown.split(SUMMARY_MARKER).length, 2);
    assert.ok(markdown.endsWith('._\n') && !markdown.endsWith('\n\n'), 'ends with the footer and one newline');
  });
}

test('SUMMARY_MARKER and MAX_SUMMARY_BYTES', () => {
  assert.equal(SUMMARY_MARKER, '<!-- qa-core-prcheck:summary -->');
  assert.equal(MAX_SUMMARY_BYTES, 60000);
});

const headingOf = (markdown) => markdown.split('\n')[1];

test('verdict mapping: the five run verdicts and the pre-run error', () => {
  const mapped = ['passed', 'failed', 'no-tests-needed', 'not-run', 'error', 'pre-run-error'].map((name) => {
    const { verdict, markdown } = formatSummary(summaryInput(name));
    return [name, verdict, headingOf(markdown)];
  });
  assert.deepEqual(mapped, [
    ['passed', 'passed', '## PR Check: Passed'],
    ['failed', 'failed', '## PR Check: Failed'],
    ['no-tests-needed', 'no-tests-needed', '## PR Check: No Tests Needed'],
    ['not-run', 'not-run', '## PR Check: Not Run (Dry Run)'],
    ['error', 'error', '## PR Check: Error'],
    ['pre-run-error', 'error', '## PR Check: Error'],
  ]);
});

/** The full-suite-run input with the result changed. */
function fullSuiteWith(change) {
  const input = summaryInput('full-suite-run');
  Object.assign(input.result, change);
  return input;
}

test('mode full adds (Full Suite Run) after Passed, Failed and Error, but not after Not Run', () => {
  const headings = [
    fullSuiteWith({ verdict: 'passed', exitCode: 0 }),
    fullSuiteWith({}),
    fullSuiteWith({ verdict: 'error', exitCode: 2, errors: ['Playwright exited with code 1 but no test failed'] }),
    fullSuiteWith({ verdict: 'not-run', exitCode: 0, tests: [] }),
  ].map((input) => headingOf(formatSummary(input).markdown));
  assert.deepEqual(headings, [
    '## PR Check: Passed (Full Suite Run)',
    '## PR Check: Failed (Full Suite Run)',
    '## PR Check: Error (Full Suite Run)',
    '## PR Check: Not Run (Dry Run)',
  ]);
});

test('mode full has the Why The Full Suite Was Picked section; mode subset does not', () => {
  const full = formatSummary(summaryInput('full-suite-run')).markdown;
  assert.ok(full.includes('\n### Why The Full Suite Was Picked\n- Playwright config changed: demo/shop/playwright.config.ts\n'));
  for (const name of ['passed', 'failed', 'not-run', 'error']) {
    assert.ok(!formatSummary(summaryInput(name)).markdown.includes('Why The Full Suite'), name);
  }
});

test('an error after some tests ran shows the counts table', () => {
  const { markdown } = formatSummary(fullSuiteWith({ verdict: 'error', exitCode: 2, errors: ['Playwright exited with code 1 but no test failed'] }));
  assert.ok(markdown.includes('\n| 7 | 3 | 1 | 1 | 1 | 1 | 0 | 1.7s |\n'));
  assert.ok(markdown.includes('\n### Errors\n- Playwright exited with code 1 but no test failed\n'));
});

test('Failures rows follow the RunResult order, with file:line, the status word and the first error line', () => {
  const input = summaryInput('full-suite-run');
  const [a, b, c, d, e, failed, timedOut] = input.result.tests;
  // Put the timed out test first and make one passed test interrupted with no error message.
  input.result.tests = [timedOut, a, b, c, d, { ...e, status: 'interrupted', error: null }, failed];
  const { markdown } = formatSummary(input);
  const start = markdown.indexOf('### Failures\n');
  assert.equal(markdown.slice(start, markdown.indexOf('\n\n', start)), [
    '### Failures',
    '| Status | Test | Location | First Error Line |',
    '| --- | --- | --- | --- |',
    '| timed out | checkout &gt; waits for the payment page [desktop] | `demo/shop/tests/checkout/checkout.spec.ts:9` | Test timeout of 500ms exceeded. |',
    '| interrupted | cart &gt; sells the onesie for free [desktop] | `demo/shop/tests/cart/cart.spec.ts:17` | No error message |',
    '| failed | checkout &gt; counts the items in the cart [desktop] | `demo/shop/tests/checkout/checkout.spec.ts:4` | Error: expect(received).toBe(expected) // Object.is equality |',
  ].join('\n'));
});

test('passed with no tests: its own lead, and every picked spec shows no tests ran', () => {
  const input = summaryInput('passed');
  input.result.tests = [];
  input.result.counts = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, timedOut: 0, interrupted: 0 };
  const { markdown } = formatSummary(input);
  assert.equal(markdown.split('\n')[3], 'Passed, but no tests ran for the picked specs.');
  assert.ok(markdown.includes('| `demo/saucedemo/tests/cart/cart.spec.ts` | 2 | no tests ran |'));
  assert.ok(markdown.includes('| `demo/saucedemo/tests/checkout/checkout.spec.ts` | 2 | no tests ran |'));
});

test('a spec whose tests were all skipped shows skipped', () => {
  const input = summaryInput('passed');
  input.result.tests = input.result.tests.map((t) => ({ ...t, status: 'skipped' }));
  assert.ok(formatSummary(input).markdown.includes('| `demo/saucedemo/tests/cart/cart.spec.ts` | 2 | skipped |'));
});

test('an error after the selection with no result: Picked Specs not run, footer from the selection', () => {
  const { selection } = inputOf('passed');
  const error = 'Cannot create a temp folder for the Playwright report: ENOSPC';
  const summary = formatSummary({ selection, result: null, error, version: VERSION });
  assert.equal(summary.markdown, lines(
    SUMMARY_MARKER,
    '## PR Check: Error',
    '',
    'The check could not finish, so the test result is unknown. See Errors below.',
    '',
    '### Picked Specs',
    '| Spec | Tests | Result | Reasons |',
    '| --- | ---: | --- | --- |',
    '| `demo/saucedemo/tests/cart/cart.spec.ts` | 2 | not run | demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/cart/cart.spec.ts |',
    '| `demo/saucedemo/tests/checkout/checkout.spec.ts` | 2 | not run | demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/checkout/checkout.spec.ts |',
    '',
    '### Errors',
    `- ${error}`,
    '',
    '---',
    '_Advisory check, exit code 2. Mode subset, 2 of 4 specs picked. qa-core-prcheck 0.0.0-test._',
  ));
});

test('no result and no error is a ReportError', () => {
  assert.throws(() => formatSummary({ selection: null, result: null, error: null, version: VERSION }), (error) => {
    assert.ok(error instanceof ReportError);
    assert.equal(error.message, 'A summary needs a run result or an error');
    return true;
  });
});

const COUNTS_FAILED = [
  '| Total | Passed | Failed | Flaky | Skipped | Timed Out | Interrupted | Duration |',
  '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  '| 2 | 0 | 1 | 0 | 0 | 1 | 0 | 1.9s |',
];
const FOOTER_FAILED = ['---', '_Advisory check, exit code 1. Mode subset, 1 of 2 specs picked. qa-core-prcheck 0.0.0-test._'];
const noteFailed = (cap, omitted) => `_Summary shortened to fit ${cap} bytes: ${omitted} rows or items left out. The full result is in prcheck-results.json._`;

test('truncated: at most maxBytes, with marker, heading and counts, ending with the note and footer', () => {
  const { markdown, truncated, omitted } = formatSummary(summaryInput('failed', { maxBytes: 900 }));
  assert.ok(bytes(markdown) <= 900, `${bytes(markdown)} bytes`);
  assert.deepEqual([truncated, omitted], [true, 2]);
  assert.ok(markdown.startsWith(`${SUMMARY_MARKER}\n## PR Check: Failed\n`));
  assert.ok(markdown.includes(`\n${COUNTS_FAILED.join('\n')}\n`));
  assert.ok(markdown.endsWith(lines(noteFailed(900, 2), '', ...FOOTER_FAILED)));
});

test('a single huge title with a small maxBytes still fits: every row goes, the rest stays', () => {
  const input = summaryInput('failed', { maxBytes: 600 });
  input.result.tests[0].title = `checkout > ${'x'.repeat(100000)}`;
  const { markdown, truncated, omitted } = formatSummary(input);
  assert.ok(bytes(markdown) <= 600, `${bytes(markdown)} bytes`);
  assert.deepEqual([truncated, omitted], [true, 3]);
  assert.equal(markdown, lines(
    SUMMARY_MARKER, '## PR Check: Failed', '', '2 of 2 tests failed, timed out or were interrupted.', '',
    ...COUNTS_FAILED, '', noteFailed(600, 3), '', ...FOOTER_FAILED,
  ));
});

test('when only the lead is left to give, it is cut with ... to fit', () => {
  // The parts that are never removed, written by hand; the cap has three digits either way.
  const fixedFor = (cap) => lines(SUMMARY_MARKER, '## PR Check: Failed', '', ...COUNTS_FAILED, '', noteFailed(cap, 3), '', ...FOOTER_FAILED);
  // Room for a 10 byte lead plus its blank line.
  const cap = bytes(fixedFor(999)) + 2 + 10;
  const { markdown } = formatSummary(summaryInput('failed', { maxBytes: cap }));
  assert.equal(markdown, lines(
    SUMMARY_MARKER, '## PR Check: Failed', '', '2 of 2 ...', '', ...COUNTS_FAILED, '', noteFailed(cap, 3), '', ...FOOTER_FAILED,
  ));
  assert.equal(bytes(markdown), cap);
});

test('a cap below the parts that are never removed is a ReportError that names both numbers', () => {
  const fixed = lines(
    SUMMARY_MARKER, '## PR Check: Error', '', '_Summary shortened to fit 50 bytes: 1 row or item left out._', '',
    '---', '_Advisory check, exit code 2. qa-core-prcheck 0.0.0-test._',
  );
  assert.throws(() => formatSummary(summaryInput('pre-run-error', { maxBytes: 50 })), (error) => {
    assert.ok(error instanceof ReportError, `expected ReportError, got ${error}`);
    assert.equal(error.message, `Cannot fit the summary in 50 bytes: the marker, heading, counts, note and footer need ${bytes(fixed)} bytes`);
    return true;
  });
});

test('a dry run that is cut points to --json, since it writes no file', () => {
  const { markdown } = formatSummary(summaryInput('not-run', { maxBytes: 500 }));
  assert.ok(bytes(markdown) <= 500);
  assert.ok(markdown.includes('\n_Summary shortened to fit 500 bytes: 2 rows or items left out. check --dry-run --json prints the full selection._\n'));
});

test('a title that holds the marker is escaped, so the summary has exactly one marker', () => {
  const input = summaryInput('failed');
  input.result.tests[0].title = SUMMARY_MARKER;
  const { markdown } = formatSummary(input);
  assert.equal(markdown.split(SUMMARY_MARKER).length, 2);
  assert.ok(markdown.includes('| failed | &lt;!-- qa-core-prcheck:summary --&gt; [desktop] |'));
});

test('the plain text @cart never appears outside code spans', () => {
  const input = summaryInput('full-suite-run');
  const { selection, result } = input;
  result.tests = result.tests.map((t) => ({ ...t, title: `${t.title} @cart`, project: '@desktop', error: t.error && `${t.error} @cart` }));
  result.errors = ['@cart failed to load'];
  result.warnings = ['Unresolved import "@cart/helpers" in demo/shop/tests/cart/cart.spec.ts'];
  selection.fullSuiteReasons = ['@cart changed the config'];
  selection.selected[0].reasons = ['@cart is imported by @team'];
  selection.selected[0].file = 'demo/shop/tests/@cart/cart.spec.ts';
  const { markdown } = formatSummary(input);
  const outsideCode = markdown.replace(/`[^`]*`/g, '');
  assert.ok(markdown.includes('`demo/shop/tests/@cart/cart.spec.ts`'), 'the path keeps its @ inside the code span');
  assert.ok(!outsideCode.includes('@cart'), outsideCode);
  assert.ok(!outsideCode.includes('@'), outsideCode);
  assert.ok(outsideCode.includes('&#64;&#8203;cart'));
});

test('no output has an em or en dash, and no golden file has one', () => {
  for (const [, input, extra] of CASES) assert.ok(!DASHES.test(formatSummary(summaryInput(input, extra)).markdown), input);
  const goldens = fs.readdirSync(fixtures).filter((name) => name.endsWith('.md'));
  assert.equal(goldens.length, 9); // the eight goldens and README.md
  for (const name of goldens) assert.ok(!DASHES.test(fs.readFileSync(path.join(fixtures, name), 'utf8')), name);
});

test('an em dash in a test title from the PR passes through unchanged', () => {
  const dash = String.fromCodePoint(0x2014);
  const input = summaryInput('failed');
  input.result.tests[0].title = `checkout ${dash} counts the items`;
  assert.ok(formatSummary(input).markdown.includes(`| failed | checkout ${dash} counts the items [desktop] |`));
});
