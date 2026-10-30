// The one place that writes summary Markdown. Pure: no file system, no environment, no clock.
//
// Layout. A blank line separates blocks; blocks marked "only" are left out otherwise.
//
//   <!-- qa-core-prcheck:summary -->
//   ## PR Check: <Label>
//
//   <Lead>
//
//   Counts table                       only when the run started
//   ### Why The Full Suite Was Picked  only in mode full
//   ### Failures                       only when a test failed, timed out or was interrupted
//   ### Flaky Tests                    only when a test is flaky
//   ### Picked Specs                   only in mode subset or full
//   ### Errors                         only when not empty
//   ### Warnings                       only when not empty; deleted specs come first
//   ### Suggested Tests                only when the selection has suggestions; at most MAX_SUGGESTION_ROWS
//                                      rows, and a cap note before the table when fewer rows are shown
//                                      than there are suggestions (the row cap or the byte cut)
//   Truncation note                    only when the cap left something out
//
//   ---
//   _Advisory check, exit code <n>. Mode <mode>, <picked> of <total> specs picked. qa-core-prcheck <version>._

import type { Selection } from '../impact/index.js';
import { deletedSpecReason } from '../impact/map.js';
import type { RunResult, RunVerdict, TestResult, TestStatus } from '../run/index.js';
import { cell, codeSpan, plural } from './markdown.js';
import { ReportError, type Summary, type SummaryInput, type SummaryVerdict } from './types.js';

export const SUMMARY_MARKER = '<!-- qa-core-prcheck:summary -->';

// The most UTF-8 bytes a summary may have. A chosen limit, kept below the PR comment limit so PR 6 can
// add a line. That limit is not confirmed by GitHub docs: 65536 is seen only in third party reports of
// the API error "Body is too long (maximum is 65536 characters)", and the docs do not say whether it
// counts bytes, UTF-16 units or characters. A string never has fewer UTF-8 bytes than either, so a byte
// cap is safe for all three. A job summary may have 1 MiB per step:
// https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
export const MAX_SUMMARY_BYTES = 60_000;

// The most suggestion rows the summary shows. A chosen limit, so advice never crowds out the result;
// the selection JSON lists every suggestion.
const MAX_SUGGESTION_ROWS = 10;

const VERDICTS: Record<RunVerdict, SummaryVerdict> = {
  passed: 'passed',
  failed: 'failed',
  'nothing-to-run': 'no-tests-needed',
  'not-run': 'not-run',
  error: 'error',
};
const LABELS: Record<SummaryVerdict, string> = {
  passed: 'Passed',
  failed: 'Failed',
  'no-tests-needed': 'No Tests Needed',
  'not-run': 'Not Run (Dry Run)',
  error: 'Error',
};
const FULL_SUITE_LABELS = new Set<SummaryVerdict>(['passed', 'failed', 'error']);
const FAILING: Partial<Record<TestStatus, string>> = { failed: 'failed', timedOut: 'timed out', interrupted: 'interrupted' };

const COUNTS_TABLE = [
  '| Total | Passed | Failed | Flaky | Skipped | Timed Out | Interrupted | Duration |',
  '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];

type SectionName = 'why' | 'failures' | 'flaky' | 'picked' | 'errors' | 'warnings' | 'suggestions';
// A heading block with rows the cap may leave out; with no rows left, the whole block goes. A head may
// hold blank lines ('' entries), as the suggestion cap note does. headFor, when set, builds the head
// from the rows still kept, so a note in it can count the rows really shown.
interface Section { head: string[]; rows: string[]; kept: number; headFor?: (kept: number) => string[] }

function headOf(section: Section): string[] {
  return section.headFor === undefined ? section.head : section.headFor(section.kept);
}

const SUGGESTION_HEAD = ['### Suggested Tests'];
const SUGGESTION_TABLE = ['| File | Why | Suggested Test |', '| --- | --- | --- |'];

/**
 * The Suggested Tests head for shown of total suggestions. The note shows whenever fewer rows are shown
 * than there are suggestions: with the old text when only the row cap left rows out, and with the size
 * text when the byte cut of formatSummary removed rows too.
 */
function suggestionHead(shown: number, total: number): string[] {
  if (shown >= total) return [...SUGGESTION_HEAD, ...SUGGESTION_TABLE];
  const why = shown === MAX_SUGGESTION_ROWS ? 'a chosen limit' : 'shortened to fit the summary size';
  const note = `Showing the first ${shown} of ${total} suggestions (${why}). The selection JSON lists all of them.`;
  return [...SUGGESTION_HEAD, '', note, '', ...SUGGESTION_TABLE];
}

const DOCUMENT_ORDER: SectionName[] = ['why', 'failures', 'flaky', 'picked', 'errors', 'warnings', 'suggestions'];
// Rows go from the end of each section, one section after the other, until the summary fits.
// Suggestions go first: they are advice, not the result.
const REMOVAL_ORDER: SectionName[] = ['suggestions', 'picked', 'warnings', 'why', 'flaky', 'failures', 'errors'];

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

// Plain code unit order, so the result never depends on the machine locale.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The spec files the change deletes, sorted: decisions of class spec with status deleted and exactly
 * the deleted spec reason of rule 7. The old path of a renamed spec has another reason, so a rename is
 * never counted.
 */
function deletedSpecsOf(selection: Selection | null): string[] {
  if (selection === null) return [];
  return selection.decisions
    .filter((d) => d.fileClass === 'spec' && d.status === 'deleted' && d.reason === deletedSpecReason(d.path))
    .map((d) => d.path)
    .sort(compareText);
}

function render(blocks: string[][]): string {
  return `${blocks.map((block) => block.join('\n')).join('\n\n')}\n`;
}

function leadOf(verdict: SummaryVerdict, result: RunResult | null, deletedSpecs: number): string {
  if (verdict === 'no-tests-needed' && deletedSpecs > 0) {
    return `No tests ran. This PR deletes ${plural(deletedSpecs, 'spec file')} and changes nothing that affects a remaining spec.`;
  }
  if (verdict === 'no-tests-needed') return 'No changed file affects a Playwright spec, so no tests ran.';
  if (verdict === 'not-run') return 'Dry run: the Playwright command was built and no test ran.';
  if (verdict === 'error' || result === null) return 'The check could not finish, so the test result is unknown. See Errors below.';
  const c = result.counts;
  if (verdict === 'failed') return `${c.failed + c.timedOut + c.interrupted} of ${plural(c.total, 'test')} failed, timed out or were interrupted.`;
  if (c.total === 0) return 'Passed, but no tests ran for the picked specs.';
  return `Every picked test passed: ${plural(c.total, 'test')} in ${plural(result.specs.length, 'spec')}.`;
}

function countsRow(result: RunResult): string {
  const c = result.counts;
  const cells = [c.total, c.passed, c.failed, c.flaky, c.skipped, c.timedOut, c.interrupted].map(String);
  return `| ${[...cells, `${(result.durationMs / 1000).toFixed(1)}s`].join(' | ')} |`;
}

const testCell = (test: TestResult): string => `${cell(test.title)} [${cell(test.project)}]`;
const location = (test: TestResult): string => codeSpan(`${test.file}:${test.line}`);

function specResult(tests: TestResult[] | undefined, result: RunResult | null): string {
  if (result === null || result.verdict === 'not-run') return 'not run';
  if (tests === undefined) return result.verdict === 'error' ? 'not run' : 'no tests ran';
  if (tests.some((test) => FAILING[test.status] !== undefined)) return 'failed';
  if (tests.some((test) => test.status === 'flaky')) return 'passed (flaky)';
  if (tests.every((test) => test.status === 'skipped')) return 'skipped';
  return 'passed';
}

function section(head: string[], rows: string[]): Section {
  return { head, rows, kept: rows.length };
}

function sectionsOf(
  selection: Selection | null, result: RunResult | null, error: string | null, deletedSpecs: string[],
): Record<SectionName, Section> {
  const tests = result?.tests ?? [];
  const byFile = new Map<string, TestResult[]>();
  for (const test of tests) {
    const list = byFile.get(test.file);
    if (list === undefined) byFile.set(test.file, [test]);
    else list.push(test);
  }
  const picked = selection !== null && selection.mode !== 'none' ? selection.selected : [];
  const fullSuiteReasons = selection?.mode === 'full' ? selection.fullSuiteReasons : [];
  const errors = result !== null ? result.errors : error !== null ? [error] : [];
  const warnings = result?.warnings ?? selection?.warnings ?? [];
  // A Selection recorded before PR 7 has no suggestions key, which counts as none.
  const suggestions = selection?.suggestions ?? [];
  const suggestionRows = suggestions.slice(0, MAX_SUGGESTION_ROWS).map((s) => `| ${codeSpan(s.file)} | ${cell(s.reason)} | ${cell(s.idea)} |`);

  return {
    why: section(['### Why The Full Suite Was Picked'], fullSuiteReasons.map((reason) => `- ${cell(reason)}`)),
    failures: section(
      ['### Failures', '| Status | Test | Location | First Error Line |', '| --- | --- | --- | --- |'],
      tests.flatMap((test) => {
        const status = FAILING[test.status];
        if (status === undefined) return [];
        return [`| ${status} | ${testCell(test)} | ${location(test)} | ${test.error === null ? 'No error message' : cell(test.error)} |`];
      }),
    ),
    flaky: section(
      ['### Flaky Tests', '| Test | Location | Attempts |', '| --- | --- | ---: |'],
      tests.filter((test) => test.status === 'flaky').map((test) => `| ${testCell(test)} | ${location(test)} | ${test.attempts} |`),
    ),
    picked: section(
      ['### Picked Specs', '| Spec | Tests | Result | Reasons |', '| --- | ---: | --- | --- |'],
      picked.map((spec) => {
        const reasons = spec.reasons.map((reason) => cell(reason)).join('<br>');
        return `| ${codeSpan(spec.file)} | ${spec.testCount} | ${specResult(byFile.get(spec.file), result)} | ${reasons} |`;
      }),
    ),
    errors: section(['### Errors'], errors.map((line) => `- ${cell(line)}`)),
    warnings: section(['### Warnings'], [
      ...deletedSpecs.map((file) => `- Spec deleted, its tests no longer run: ${codeSpan(file)}`),
      ...warnings.map((line) => `- ${cell(line)}`),
    ]),
    suggestions: {
      ...section(suggestionHead(suggestionRows.length, suggestions.length), suggestionRows),
      // The cap note is built from the rows the byte cut leaves, not from the rows before it.
      headFor: (kept: number) => suggestionHead(kept, suggestions.length),
    },
  };
}

function noteOf(maxBytes: number, omitted: number, result: RunResult | null): string {
  const left = `${omitted} ${omitted === 1 ? 'row or item' : 'rows or items'} left out.`;
  const where = result === null ? ''
    : result.verdict === 'not-run' ? ' check --dry-run --json prints the full selection.'
    : ' The full result is in prcheck-results.json.';
  return `_Summary shortened to fit ${maxBytes} bytes: ${left}${where}_`;
}

/** The longest start of text, ended with "...", that fits in room bytes; empty when nothing fits. */
function cutToBytes(text: string, room: number): string {
  if (bytes(text) <= room) return text;
  let out = '';
  for (const char of text) {
    if (bytes(out + char) + 3 > room) break;
    out += char;
  }
  return out === '' ? '' : `${out}...`;
}

/**
 * The Markdown summary of a check: the selection, the run result, or the error that stopped the check
 * before the run. It starts with SUMMARY_MARKER, which appears once, and never has more UTF-8 bytes
 * than maxBytes. Every value from the PR is escaped. The input is not changed.
 */
export function formatSummary(input: SummaryInput): Summary {
  const { selection, result, error, version } = input;
  const maxBytes = input.maxBytes ?? MAX_SUMMARY_BYTES;
  if (result === null && error === null) throw new ReportError('A summary needs a run result or an error');

  const verdict: SummaryVerdict = result === null ? 'error' : VERDICTS[result.verdict];
  const mode = result?.mode ?? selection?.mode ?? null;
  const fullSuite = mode === 'full';
  const label = `${LABELS[verdict]}${fullSuite && FULL_SUITE_LABELS.has(verdict) ? ' (Full Suite Run)' : ''}`;
  const exitCode = result?.exitCode ?? 2;
  const started = result !== null && (verdict === 'passed' || verdict === 'failed' || (verdict === 'error' && result.tests.length > 0));

  const top = [SUMMARY_MARKER, `## PR Check: ${label}`];
  const deletedSpecs = deletedSpecsOf(selection);
  let lead = leadOf(verdict, result, deletedSpecs.length);
  const counts = started ? [...COUNTS_TABLE, countsRow(result)] : null;
  const sections = sectionsOf(selection, result, error, deletedSpecs);
  const picked = result?.specs.length ?? selection?.selected.length ?? 0;
  const footer = [
    '---',
    selection === null
      ? `_Advisory check, exit code ${exitCode}. qa-core-prcheck ${version}._`
      : `_Advisory check, exit code ${exitCode}. Mode ${mode}, ${picked} of ${selection.totalSpecs} specs picked. qa-core-prcheck ${version}._`,
  ];

  const build = (note: string | null): string => render([
    top,
    ...(lead === '' ? [] : [[lead]]),
    ...(counts === null ? [] : [counts]),
    ...DOCUMENT_ORDER.flatMap((name) => {
      const current = sections[name];
      return current.kept === 0 ? [] : [[...headOf(current), ...current.rows.slice(0, current.kept)]];
    }),
    ...(note === null ? [] : [[note]]),
    footer,
  ]);

  const whole = build(null);
  if (bytes(whole) <= maxBytes) return { markdown: whole, verdict, fullSuite, truncated: false, omitted: 0 };

  // Size bookkeeping without rendering again for every row: a row costs its bytes plus the line
  // break before it; the last row of a section takes the heading and the blank line with it. The head
  // is counted joined with line breaks, as build renders it, so blank lines inside it count too. A
  // section whose head depends on the rows kept (Suggested Tests, with its cap note) is rendered again
  // after each removed row instead, at most MAX_SUGGESTION_ROWS times.
  let size = bytes(whole);
  let omitted = 0;
  const withNote = (): number => size + bytes(noteOf(maxBytes, omitted, result)) + 2;
  for (const name of REMOVAL_ORDER) {
    const current = sections[name];
    while (current.kept > 0 && withNote() > maxBytes) {
      const row = current.rows[current.kept - 1]!;
      const head = headOf(current);
      current.kept--;
      omitted++;
      if (current.headFor !== undefined) size = bytes(build(null));
      else size -= current.kept === 0 ? bytes(head.join('\n')) + 1 + bytes(row) + 2 : bytes(row) + 1;
    }
  }

  if (withNote() > maxBytes) {
    // Every row is gone; only the lead can still give way. The rest is never removed.
    const fixed = withNote() - (bytes(lead) + 2);
    if (fixed > maxBytes) {
      throw new ReportError(`Cannot fit the summary in ${maxBytes} bytes: the marker, heading, counts, note and footer need ${fixed} bytes`);
    }
    lead = cutToBytes(lead, maxBytes - fixed - 2);
  }
  return { markdown: build(noteOf(maxBytes, omitted, result)), verdict, fullSuite, truncated: true, omitted };
}
