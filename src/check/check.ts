import path from 'node:path';
import type { DiffResult } from '../diff/index.js';
import { selectTests, type Selection } from '../impact/index.js';
import { formatSummary, type Summary } from '../report/index.js';
import { cleanErrorLine, runSelection, type RunResult } from '../run/index.js';

export interface CheckOptions {
  root: string;                  // absolute repository root; diff paths are relative to it
  diff: DiffResult;
  env?: NodeJS.ProcessEnv;       // merged over process.env for both Playwright runs, then cleaned
  dryRun?: boolean;              // pick and build the command, but start no test
  playwrightCli?: string;        // for tests only: replaces the CLI found from root for the test run
  timeoutMs?: number;            // the kill timeout of the test run
  version: string;               // the tool version for the summary footer
}

export interface CheckResult { selection: Selection; result: RunResult; summary: Summary }

/**
 * Picks the specs once, runs them and formats the summary. It writes no file; the CLI does that.
 * Expected failures before the run throw DiffError, InventoryError, ImpactError or RunError, as
 * runSelected does.
 */
export async function runCheck(options: CheckOptions): Promise<CheckResult> {
  const { root, diff, env, version, ...run } = options;
  const selection = await selectTests({ root, diff, env });
  const result = await runSelection({ ...run, root, env, selection });
  return { selection, result, summary: formatSummary({ selection, result, error: null, version }) };
}

/**
 * An error that stopped the check before the run, as one line for the summary: cleaned like every
 * RunResult error, with any absolute root left in it shown as <root>.
 */
export function checkErrorLine(message: string, root: string): string {
  const line = cleanErrorLine(message, root);
  return root === path.parse(root).root ? line : line.split(root).join('<root>');
}
