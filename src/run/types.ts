import type { DiffSource } from '../diff/index.js';
import type { SelectionMode } from '../impact/index.js';

export type TestStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'timedOut' | 'interrupted';

export type RunVerdict = 'passed' | 'failed' | 'nothing-to-run' | 'not-run' | 'error';

export interface TestResult {
  file: string;            // repo-relative POSIX
  line: number;
  title: string;           // describe titles and test title joined with " > ", as in the inventory
  project: string;
  tags: string[];          // sorted, with the leading @
  status: TestStatus;
  attempts: number;        // number of results Playwright recorded (retries plus one)
  durationMs: number;      // sum over all attempts
  error: string | null;    // first line of the last failing attempt, cleaned; null when it passed or was skipped
}

export interface RunCounts {
  total: number; passed: number; failed: number; flaky: number;
  skipped: number; timedOut: number; interrupted: number;
}

export interface RunResult {
  schemaVersion: 1;
  source: DiffSource;
  mode: SelectionMode;
  playwrightDir: string;
  specs: string[];          // spec files passed to Playwright (empty in mode none; every spec in mode full)
  command: string[] | null; // Playwright arguments for display, repo-relative; null in mode none
  verdict: RunVerdict;
  exitCode: 0 | 1 | 2;
  counts: RunCounts;
  durationMs: number;       // Playwright's own stats.duration, rounded; 0 when nothing ran
  tests: TestResult[];      // sorted by file, line, title, project
  errors: string[];         // top-level Playwright errors and tool problems, cleaned, in order found
  warnings: string[];       // selection warnings plus runner warnings, sorted, unique
}

/** An expected failure. The message is plain and meant for the user. */
export class RunError extends Error {}
