import type { Selection } from '../impact/index.js';
import type { RunResult } from '../run/index.js';

export type SummaryVerdict = 'passed' | 'failed' | 'no-tests-needed' | 'not-run' | 'error';

export interface SummaryInput {
  selection: Selection | null;  // null when the check failed before the selection finished
  result: RunResult | null;     // null when the check failed before the run
  error: string | null;         // a typed error before the run, already repo-relative; used only when result is null
  version: string;              // tool version for the footer (tests pass a fixed value)
  maxBytes?: number;            // default MAX_SUMMARY_BYTES
}

export interface Summary {
  markdown: string;
  verdict: SummaryVerdict;
  fullSuite: boolean;           // mode was full
  truncated: boolean;
  omitted: number;              // table rows and list items left out by the cap
}

/** An expected failure. The message is plain and meant for the user. */
export class ReportError extends Error {}
