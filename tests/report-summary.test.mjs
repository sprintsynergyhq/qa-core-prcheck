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
  ['spec-deleted', 'spec-deleted', {}, 'no-tests-needed', false, false, 0],
  // The Picked Specs row and the timed out Failures row are left out.
  ['truncated', 'failed', { maxBytes: 900 }, 'failed', false, true, 2],
  ['suggestions', 'suggestions', {}, 'not-run', true, false, 0],
  // Twelve suggestions: ten rows and the cap note.
  ['suggestions-capped', 'suggestions-capped', {}, 'not-run', true, false, 0],
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
  assert.equal(goldens.length, 13); // the twelve goldens (ranked.md since PR 8) and README.md
  for (const name of goldens) assert.ok(!DASHES.test(fs.readFileSync(path.join(fixtures, name), 'utf8')), name);
});

test('an em dash in a test title from the PR passes through unchanged', () => {
  const dash = String.fromCodePoint(0x2014);
  const input = summaryInput('failed');
  input.result.tests[0].title = `checkout ${dash} counts the items`;
  assert.ok(formatSummary(input).markdown.includes(`| failed | checkout ${dash} counts the items [desktop] |`));
});

const LOGIN = 'demo/saucedemo/tests/login/login.spec.ts';
const INVENTORY = 'demo/saucedemo/tests/inventory/inventory.spec.ts';
const deletedSpec = (file) => ({ path: file, fileClass: 'spec', status: 'deleted', outcome: 'none', reason: `Spec deleted, nothing to run: ${file}`, specs: [] });

test('a subset with a deleted spec: the normal lead, and the deleted spec row in Warnings', () => {
  const input = summaryInput('passed');
  input.selection.decisions.push(deletedSpec(LOGIN));
  // passed.md with a Warnings section between Picked Specs and the footer, written by hand.
  const expected = goldenOf('passed').replace('\n---\n', lines(
    '',
    '### Warnings',
    `- Spec deleted, its tests no longer run: \`${LOGIN}\``,
    '',
    '---',
  ));
  assert.equal(formatSummary(input).markdown, expected);
});

test('deleted spec rows come first in Warnings, sorted, before the other warnings; two give the plural lead', () => {
  const input = summaryInput('no-tests-needed');
  input.selection.decisions.push(deletedSpec(LOGIN), deletedSpec(INVENTORY));
  // The warning format the import graph gives for a file it cannot read (src/impact/graph.ts).
  input.result.warnings = ['Cannot read demo/saucedemo/fixtures/users.ts'];
  assert.equal(formatSummary(input).markdown, lines(
    SUMMARY_MARKER,
    '## PR Check: No Tests Needed',
    '',
    'No tests ran. This PR deletes 2 spec files and changes nothing that affects a remaining spec.',
    '',
    '### Warnings',
    `- Spec deleted, its tests no longer run: \`${INVENTORY}\``,
    `- Spec deleted, its tests no longer run: \`${LOGIN}\``,
    '- Cannot read demo/saucedemo/fixtures/users.ts',
    '',
    '---',
    '_Advisory check, exit code 0. Mode none, 0 of 4 specs picked. qa-core-prcheck 0.0.0-test._',
  ));
});

test('a renamed spec is never shown as deleted: the summary equals no-tests-needed.md byte for byte', () => {
  const input = summaryInput('no-tests-needed');
  const oldPath = 'demo/saucedemo/tests/cart/cart.spec.ts';
  const newPath = 'demo/saucedemo/tests/cart/basket.spec.ts';
  input.selection.decisions.push(
    { path: newPath, fileClass: 'spec', status: 'renamed', outcome: 'none', reason: `Not in the Playwright inventory: ${newPath}`, specs: [] },
    { path: oldPath, fileClass: 'spec', status: 'deleted', outcome: 'none', reason: `Spec renamed: ${oldPath} to ${newPath}`, specs: [] },
  );
  assert.equal(formatSummary(input).markdown, goldenOf('no-tests-needed'));
});

test('only the exact deleted spec reason counts: a deleted spec decided by another rule adds no row', () => {
  const input = summaryInput('no-tests-needed');
  input.selection.decisions.push({ ...deletedSpec(LOGIN), outcome: 'ignored', reason: 'Ignored by pattern "demo/saucedemo/tests/login/**"' });
  assert.equal(formatSummary(input).markdown, goldenOf('no-tests-needed'));
});

// Suggested Tests

const WISHLIST = 'demo/saucedemo/pages/wishlist-page.ts';
const WISHLIST_SUGGESTION = {
  file: WISHLIST,
  kind: 'unimported-support',
  reason: 'No spec imports this file.',
  idea: `Add a spec that imports ${WISHLIST} and uses it, or remove the file if nothing needs it.`,
};
const WISHLIST_SECTION = [
  '### Suggested Tests',
  '| File | Why | Suggested Test |',
  '| --- | --- | --- |',
  `| \`${WISHLIST}\` | No spec imports this file. | Add a spec that imports ${WISHLIST} and uses it, or remove the file if nothing needs it. |`,
];
const CAP_NOTE = 'Showing the first 10 of 12 suggestions (a chosen limit). The selection JSON lists all of them.';
// The note when the byte cut of the summary left suggestion rows out (PR 7a).
const SHORT_NOTE = (shown, total) =>
  `Showing the first ${shown} of ${total} suggestions (shortened to fit the summary size). The selection JSON lists all of them.`;
const noteDryRun = (cap, omitted) =>
  `_Summary shortened to fit ${cap} bytes: ${omitted} ${omitted === 1 ? 'row or item' : 'rows or items'} left out. check --dry-run --json prints the full selection._`;

test('Suggested Tests shows in every verdict that has a selection, as the last section before the footer', () => {
  for (const name of ['passed', 'failed', 'no-tests-needed', 'not-run', 'error']) {
    const input = summaryInput(name);
    input.selection.suggestions = [WISHLIST_SUGGESTION];
    // The golden with the section added before the footer, written by hand.
    const expected = goldenOf(name).replace('\n---\n', lines('', ...WISHLIST_SECTION, '', '---'));
    assert.equal(formatSummary(input).markdown, expected, name);
  }
});

test('Suggested Tests shows after an error that came after the selection, with no run result', () => {
  const { selection } = inputOf('passed');
  selection.suggestions = [WISHLIST_SUGGESTION];
  const { markdown } = formatSummary({ selection, result: null, error: 'Cannot create a temp folder for the Playwright report: ENOSPC', version: VERSION });
  assert.ok(markdown.includes(lines('### Errors', '- Cannot create a temp folder for the Playwright report: ENOSPC', '', ...WISHLIST_SECTION, '', '---')));
});

test('Suggested Tests comes after Warnings', () => {
  const input = summaryInput('suggestions');
  input.result.warnings = ['Cannot read demo/shop/fixtures/users.ts'];
  const expected = goldenOf('suggestions').replace('\n### Suggested Tests\n', lines('', '### Warnings', '- Cannot read demo/shop/fixtures/users.ts', '', '### Suggested Tests'));
  assert.equal(formatSummary(input).markdown, expected);
});

test('a selection with no suggestions key renders as an empty list, which adds nothing', () => {
  const input = summaryInput('passed');
  assert.equal('suggestions' in input.selection, false);
  const withEmpty = summaryInput('passed');
  withEmpty.selection.suggestions = [];
  assert.equal(formatSummary(input).markdown, goldenOf('passed'));
  assert.equal(formatSummary(withEmpty).markdown, goldenOf('passed'));
});

test('exactly 10 suggestions show 10 rows and no cap note; 11 show 10 rows and the note with 11', () => {
  const ten = summaryInput('suggestions-capped');
  ten.selection.suggestions = ten.selection.suggestions.slice(0, 10);
  assert.equal(formatSummary(ten).markdown, goldenOf('suggestions-capped').replace(`\n\n${CAP_NOTE}\n\n`, '\n'));
  const eleven = summaryInput('suggestions-capped');
  eleven.selection.suggestions = eleven.selection.suggestions.slice(0, 11);
  assert.equal(formatSummary(eleven).markdown, goldenOf('suggestions-capped').replace(CAP_NOTE, CAP_NOTE.replace('of 12', 'of 11')));
});

// The parts of the suggestions golden, written by hand, for the byte cap cases below.
const SUGGESTIONS_TOP = [
  SUMMARY_MARKER, '## PR Check: Not Run (Dry Run)', '', 'Dry run: the Playwright command was built and no test ran.', '',
  '### Why The Full Suite Was Picked', '- No rule maps src/cart/total.ts (app-source) to a test', '',
  '### Picked Specs', '| Spec | Tests | Result | Reasons |', '| --- | ---: | --- | --- |',
  '| `demo/shop/tests/cart/cart.spec.ts` | 4 | not run | Part of the full suite run |',
  '| `demo/shop/tests/checkout/checkout.spec.ts` | 2 | not run | Part of the full suite run |',
];
const SUGGESTIONS_FOOTER = ['---', '_Advisory check, exit code 0. Mode full, 3 of 3 specs picked. qa-core-prcheck 0.0.0-test._'];
const TOTAL_ROW = '| `src/cart/total.ts` | No rule or spec maps this file, so it falls back to the full suite. | Add a spec that covers the behaviour in src/cart/total.ts, or map it to a tag with an area in qa-core-prcheck.config.json. |';
// The cap that makes the expected summary exactly cap bytes long. The note holds the cap itself, so this
// repeats until the number of digits stops changing.
function exactCap(expectedFor) {
  let cap = 0;
  while (bytes(expectedFor(cap)) !== cap) cap = bytes(expectedFor(cap));
  return cap;
}
const INVENTORY_SUGGESTION_ROW = '| `demo/shop/pages/inventory-page.ts` | sortBy was added or changed here, and no file that imports this one uses it. | Add a test that calls sortBy. |';
const PRODUCT_SORT_ROW = '| `demo/shop/pages/product-sort-page.ts` | No spec imports this file. | Add a spec that imports demo/shop/pages/product-sort-page.ts and uses it, or remove the file if nothing needs it. |';

test('the byte cap removes the last suggestion row first, and the size lands exactly on maxBytes', () => {
  // PR 7a: a byte cut now adds the size note to the head. That note costs more than the last row saves,
  // so 2 of 3 rows can never fit exactly; the last two rows go, from the end, and 1 of 3 is shown.
  const expectedFor = (cap) => goldenOf('suggestions').replace(`\n${TOTAL_ROW}`, '').replace(`\n${INVENTORY_SUGGESTION_ROW}`, '')
    .replace('### Suggested Tests\n', lines('### Suggested Tests', '', SHORT_NOTE(1, 3), ''))
    .replace('\n---\n', lines('', noteDryRun(cap, 2), '', '---'));
  const cap = exactCap(expectedFor);
  const summary = formatSummary(summaryInput('suggestions', { maxBytes: cap }));
  assert.equal(summary.markdown, expectedFor(cap));
  assert.deepEqual([summary.truncated, summary.omitted, bytes(summary.markdown)], [true, 2, cap]);
});

test('every suggestion row goes before any Picked Specs row', () => {
  // The three suggestion rows and the last Picked Specs row are left out.
  const expectedFor = (cap) => lines(...SUGGESTIONS_TOP, '', noteDryRun(cap, 4), '', ...SUGGESTIONS_FOOTER);
  const cap = exactCap(expectedFor);
  const summary = formatSummary(summaryInput('suggestions', { maxBytes: cap }));
  assert.equal(summary.markdown, expectedFor(cap));
  assert.deepEqual([summary.omitted, bytes(summary.markdown)], [4, cap]);
});

test('with the cap note in the head, the byte bookkeeping still lands exactly on maxBytes', () => {
  // One row: the last shown suggestion row goes and the cap note now counts the 9 rows shown (PR 7a).
  const oneRow = (cap) => goldenOf('suggestions-capped').replace(`\n${PRODUCT_SORT_ROW}`, '').replace(CAP_NOTE, SHORT_NOTE(9, 12))
    .replace('\n---\n', lines('', noteDryRun(cap, 1), '', '---'));
  const capOne = exactCap(oneRow);
  const first = formatSummary(summaryInput('suggestions-capped', { maxBytes: capOne }));
  assert.equal(first.markdown, oneRow(capOne));
  assert.deepEqual([first.omitted, bytes(first.markdown)], [1, capOne]);

  // Eleven rows: all ten suggestion rows, so the head with its note goes too, then the last Picked Specs row.
  const elevenRows = (cap) => lines(...SUGGESTIONS_TOP, '', noteDryRun(cap, 11), '', ...SUGGESTIONS_FOOTER);
  const capEleven = exactCap(elevenRows);
  const second = formatSummary(summaryInput('suggestions-capped', { maxBytes: capEleven }));
  assert.equal(second.markdown, elevenRows(capEleven));
  assert.deepEqual([second.omitted, bytes(second.markdown)], [11, capEleven]);
});

// The cap note after the byte cut (PR 7a). The top is lines 1 to 14 and the 10 rows are lines 22 to 31
// of the suggestions-capped golden; the sizes were picked by hand inside the range that leaves each row count.
const CAPPED_TOP = goldenOf('suggestions-capped').split('\n').slice(0, 14);
const CAPPED_ROWS = goldenOf('suggestions-capped').split('\n').slice(21, 31);
const SUGGESTION_ROW = /^\| `demo\/shop\/pages\//;
const suggestionRowsIn = (markdown) => markdown.split('\n').filter((line) => SUGGESTION_ROW.test(line)).length;
const cappedAfterCut = (cap, shown) => lines(
  ...CAPPED_TOP, '',
  '### Suggested Tests', '', SHORT_NOTE(shown, 12), '', '| File | Why | Suggested Test |', '| --- | --- | --- |',
  ...CAPPED_ROWS.slice(0, shown), '',
  noteDryRun(cap, 10 - shown), '',
  ...SUGGESTIONS_FOOTER,
);

for (const [cap, shown] of [[2400, 7], [1900, 4], [1500, 2]]) {
  test(`the cap note after the byte cut: maxBytes ${cap} shows ${shown} of 12 suggestions and says so`, () => {
    assert.equal(CAPPED_ROWS.length, 10);
    const summary = formatSummary(summaryInput('suggestions-capped', { maxBytes: cap }));
    assert.equal(summary.markdown, cappedAfterCut(cap, shown));
    assert.equal(suggestionRowsIn(summary.markdown), shown);
    assert.deepEqual([summary.truncated, summary.omitted], [true, 10 - shown]);
    assert.ok(bytes(summary.markdown) <= cap);
  });
}

test('the cap note after the byte cut: maxBytes 1100 removes every suggestion row, the heading and the note', () => {
  const summary = formatSummary(summaryInput('suggestions-capped', { maxBytes: 1100 }));
  assert.equal(summary.markdown, lines(...CAPPED_TOP, '', noteDryRun(1100, 10), '', ...SUGGESTIONS_FOOTER));
  assert.equal(summary.markdown.includes('### Suggested Tests'), false);
  assert.equal(summary.markdown.includes('Showing the first'), false);
  assert.deepEqual([summary.truncated, summary.omitted], [true, 10]);
});

test('the cap note after the byte cut: a sweep over every maxBytes never exceeds it, and the note always matches the rows', () => {
  const whole = bytes(goldenOf('suggestions-capped'));
  let smallest = 0;
  for (let cap = 1; cap <= whole && smallest === 0; cap++) {
    try {
      formatSummary(summaryInput('suggestions-capped', { maxBytes: cap }));
      smallest = cap;
    } catch (error) {
      assert.ok(error instanceof ReportError, String(error));
    }
  }
  assert.ok(smallest > 0);
  for (let cap = smallest; cap <= whole; cap++) {
    const { markdown } = formatSummary(summaryInput('suggestions-capped', { maxBytes: cap }));
    assert.ok(bytes(markdown) <= cap, `maxBytes ${cap}`);
    const shown = suggestionRowsIn(markdown);
    const note = shown === 0 ? null
      : shown === 10 ? CAP_NOTE
      : SHORT_NOTE(shown, 12);
    const notes = markdown.split('\n').filter((line) => line.startsWith('Showing the first'));
    assert.deepEqual(notes, note === null ? [] : [note], `maxBytes ${cap}`);
    assert.equal(markdown.includes('### Suggested Tests'), shown > 0, `maxBytes ${cap}`);
  }
});

// The optional LLM ranking (PR 8). ranked.json is suggestions.json plus a ranking object written by
// hand, and ranked.md was written by hand from the plan before the formatter supported it.

const rankedInput = (extra = {}) => {
  const { selection, result, ranking } = inputOf('ranked');
  return { selection, result, error: null, version: VERSION, ranking, ...extra };
};
const ADVISORY = 'Ranked by LLM (advisory)';

test('summary: the ranked golden, byte for byte, and the input is not changed', () => {
  const data = rankedInput();
  const copy = structuredClone(data);
  const summary = formatSummary(data);
  assert.equal(summary.markdown, goldenOf('ranked'));
  assert.deepEqual([summary.verdict, summary.fullSuite, summary.truncated, summary.omitted], ['not-run', true, false, 0]);
  assert.deepEqual(data, copy);
});

test('summary: ranked.json is suggestions.json plus the ranking, so only the ranked blocks differ', () => {
  const { ranking, ...rest } = inputOf('ranked');
  assert.deepEqual(rest, inputOf('suggestions'));
  assert.equal(ranking.status, 'applied');
});

test('summary: no ranking gives no advisory line', () => {
  for (const [golden, input, extra] of CASES) {
    for (const ranking of [undefined, null]) {
      const markdown = formatSummary(summaryInput(input, { ...extra, ranking })).markdown;
      assert.equal(markdown, goldenOf(golden), `${golden} ${ranking}`);
      assert.ok(!markdown.includes(ADVISORY) && !markdown.includes('LLM'), golden);
    }
  }
});

test('summary: a skipped ranking adds only the Warnings line, last, and keeps the deterministic order', () => {
  const ranking = { status: 'skipped', provider: 'openai', model: 'example-model', reason: 'the provider returned status 503 (2 attempts)' };
  const markdown = formatSummary(summaryInput('suggestions', { ranking })).markdown;
  assert.equal(markdown, goldenOf('suggestions').replace('\n### Suggested Tests\n', lines(
    '', '### Warnings', '- LLM ranking skipped: the provider returned status 503 (2 attempts). The deterministic order is used.', '', '### Suggested Tests',
  )));
  // With other warnings, it comes after them.
  const failed = formatSummary(summaryInput('error', { ranking })).markdown;
  const warnings = failed.slice(failed.indexOf('### Warnings')).split('\n\n')[0].split('\n');
  assert.equal(warnings.at(-1), '- LLM ranking skipped: the provider returned status 503 (2 attempts). The deterministic order is used.');
});

test('summary: a note is escaped like every PR value', () => {
  const data = rankedInput();
  const note = '@sprintsynergyhq #1 <b>x</b> | y';
  data.ranking = { ...data.ranking, specs: data.ranking.specs.map((s, i) => (i === 0 ? { ...s, note } : s)),
    suggestions: data.ranking.suggestions.map((s, i) => (i === 0 ? { ...s, note } : s)) };
  const markdown = formatSummary(data).markdown;
  const escaped = '&#64;&#8203;sprintsynergyhq \\#&#8203;1 &lt;b&gt;x&lt;/b&gt; \\| y';
  assert.ok(markdown.includes(`| Covers`) === false);
  assert.ok(markdown.includes(`<br>Part of the full suite run | ${escaped} |\n`), markdown);
  assert.ok(markdown.includes(`Add a test that calls sortBy.<br>LLM note: ${escaped} |\n`), markdown);
  assert.ok(!markdown.includes('<b>') && !markdown.includes('@sprintsynergyhq'));
});

test('summary: the advisory line names provider and model through cell', () => {
  const data = rankedInput();
  data.ranking = { ...data.ranking, provider: 'gemini', model: 'a_b' };
  const markdown = formatSummary(data).markdown;
  assert.ok(markdown.includes('\nRanked by LLM (advisory): gemini, a\\_b. The rules picked these specs; the LLM only ordered them and wrote the notes.\n'));
});

test('summary: a ranking that does not match the picked specs or shown suggestions is ignored', () => {
  const base = rankedInput().ranking;
  const bad = [
    { ...base, specs: base.specs.slice(1) },
    { ...base, specs: [...base.specs, { file: 'demo/x.spec.ts', note: '' }] },
    { ...base, specs: [base.specs[0], base.specs[0], base.specs[1]] },
    { ...base, suggestions: base.suggestions.slice(1) },
    { ...base, suggestions: [...base.suggestions.slice(0, 2), { index: 5, note: '' }] },
  ];
  for (const ranking of bad) {
    assert.equal(formatSummary(rankedInput({ ranking })).markdown, goldenOf('suggestions'));
  }
});

test('summary: with an applied ranking and the cap note, the advisory line comes first and the LLM order is used', () => {
  const { selection, result } = inputOf('suggestions-capped');
  const ranking = {
    status: 'applied', provider: 'anthropic', model: 'example-model',
    specs: selection.selected.map((s) => ({ file: s.file, note: '' })),
    suggestions: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((index) => ({ index, note: '' })),
  };
  const markdown = formatSummary({ selection, result, error: null, version: VERSION, ranking }).markdown;
  const start = markdown.indexOf('### Suggested Tests');
  const block = markdown.slice(start, markdown.indexOf('\n\n---', start)).split('\n');
  assert.deepEqual(block.slice(0, 7), [
    '### Suggested Tests', '',
    'Ranked by LLM (advisory): anthropic, example-model. The rules made these suggestions; the LLM only ordered them and wrote the notes.', '',
    CAP_NOTE, '', '| File | Why | Suggested Test |',
  ]);
  assert.deepEqual(block.slice(8), [...CAPPED_ROWS].reverse());
});

test('summary: the byte cut drops the lowest ranked rows first', () => {
  // Cutting only the last suggestion row of ranked.md drops about-page.ts, ranked last by the LLM.
  const whole = bytes(goldenOf('ranked'));
  for (let cap = whole - 1; cap > 0; cap--) {
    const { markdown, omitted } = formatSummary(rankedInput({ maxBytes: cap }));
    if (omitted === 0) continue;
    if (!markdown.includes('### Suggested Tests')) break;
    assert.ok(!markdown.includes('`demo/shop/pages/about-page.ts`'), `maxBytes ${cap}`);
    assert.ok(markdown.includes('`demo/shop/pages/inventory-page.ts`'), `maxBytes ${cap}`);
    break;
  }
  // When the Picked Specs rows go, the lowest ranked spec (checkout) goes before the top one (inventory).
  let sawPartial = false;
  for (let cap = whole; cap > 0; cap--) {
    let markdown;
    try { ({ markdown } = formatSummary(rankedInput({ maxBytes: cap }))); } catch { break; }
    const picked = markdown.split('\n').filter((l) => l.startsWith('| `demo/shop/tests/'));
    if (picked.length > 0 && picked.length < 3) {
      sawPartial = true;
      assert.ok(picked[0].startsWith('| `demo/shop/tests/inventory/'), `maxBytes ${cap}`);
      assert.ok(!picked.some((l) => l.startsWith('| `demo/shop/tests/checkout/')), `maxBytes ${cap}`);
    }
  }
  assert.ok(sawPartial);
});

test('summary: a maxBytes sweep with a ranking never exceeds maxBytes, and the advisory line shows only with its rows', () => {
  const whole = bytes(goldenOf('ranked'));
  let checked = 0;
  for (let cap = 1; cap <= whole; cap++) {
    let markdown;
    try {
      ({ markdown } = formatSummary(rankedInput({ maxBytes: cap })));
    } catch (error) {
      assert.ok(error instanceof ReportError, String(error));
      continue;
    }
    checked++;
    assert.ok(bytes(markdown) <= cap, `maxBytes ${cap}`);
    const advisories = markdown.split('\n').filter((l) => l.startsWith(ADVISORY)).length;
    const blocks = ['### Picked Specs', '### Suggested Tests'].filter((h) => markdown.includes(h)).length;
    assert.equal(advisories, blocks, `maxBytes ${cap}`);
  }
  assert.ok(checked > 0);
});
