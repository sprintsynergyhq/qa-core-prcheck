import type { Selection } from '../impact/index.js';
import type { Summary, WrittenFiles } from '../report/index.js';
import type { RunResult } from '../run/index.js';

/**
 * The documented check JSON, keys always in this order. files is null when nothing was written: a
 * dry run, or a write that failed. exitCode is the exit code of the check, which is 2 after a write
 * failure even when the run itself gave 0 or 1.
 */
export function formatCheckJson(
  selection: Selection, result: RunResult, summary: Summary, files: WrittenFiles | null, exitCode: 0 | 1 | 2,
): string {
  const json = {
    schemaVersion: 1,
    selection,
    result,
    summary: {
      verdict: summary.verdict,
      fullSuite: summary.fullSuite,
      truncated: summary.truncated,
      omitted: summary.omitted,
      bytes: Buffer.byteLength(summary.markdown, 'utf8'),
      file: files?.summaryFile ?? null,
      stepSummary: files?.stepSummary ?? false,
    },
    exitCode,
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}
