import type { RunResult, RunVerdict, TestResult } from './types.js';

const RESULT_TEXT: Record<RunVerdict, string> = {
  passed: 'passed',
  failed: 'failed',
  'nothing-to-run': 'nothing to run',
  'not-run': 'not run (dry run)',
  error: 'error',
};
const FAILING = new Set(['failed', 'timedOut', 'interrupted']);

/** The documented JSON shape: keys in the order of the types in types.ts. */
export function formatRunJson(result: RunResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function where(test: TestResult): string {
  return `${test.file}:${test.line}  ${test.title} [${test.project}]`;
}

/** The mode, the command, the verdict and counts, then blocks for failures, flaky tests, errors and warnings. */
export function formatRunText(result: RunResult): string {
  const lines: string[] = [];
  if (result.source.type === 'git') lines.push(`Merge base: ${result.source.mergeBaseSha}`);
  lines.push(`Mode: ${result.mode}`);
  lines.push(`Specs: ${result.specs.length}`);
  if (result.command !== null) lines.push(`Command: playwright ${result.command.join(' ')}`);
  lines.push(`Result: ${RESULT_TEXT[result.verdict]}`);

  if (result.verdict === 'nothing-to-run') {
    lines.push('No specs were selected, so no tests ran.');
  } else if (result.verdict !== 'not-run') {
    const c = result.counts;
    lines.push(
      `Tests: ${c.total} total, ${c.passed} passed, ${c.failed} failed, ${c.flaky} flaky, ` +
      `${c.skipped} skipped, ${c.timedOut} timed out, ${c.interrupted} interrupted`,
    );
    lines.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  }

  const failures = result.tests.filter((test) => FAILING.has(test.status));
  if (failures.length > 0) {
    lines.push('Failures:');
    for (const test of failures) {
      lines.push(`  ${test.status}  ${where(test)}`);
      if (test.error !== null) lines.push(`    ${test.error}`);
    }
  }
  const flaky = result.tests.filter((test) => test.status === 'flaky');
  if (flaky.length > 0) {
    lines.push('Flaky:');
    for (const test of flaky) lines.push(`  ${where(test)}`);
  }
  if (result.errors.length > 0) {
    lines.push('Errors:');
    for (const error of result.errors) lines.push(`  - ${error}`);
  }
  if (result.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of result.warnings) lines.push(`  - ${warning}`);
  }
  return `${lines.join('\n')}\n`;
}
