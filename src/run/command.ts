import path from 'node:path';
import type { Selection } from '../impact/index.js';

// Stands for the absolute root in display arguments, so they read the same on every machine.
const ROOT_PLACEHOLDER = '<root>';

// Plain code unit order, so the result never depends on the machine locale.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/**
 * A positional filter that matches one file and nothing else. Playwright 1.60.0 reads a positional
 * argument as a regular expression tested against absolute file paths. A plain path becomes a case
 * insensitive, unanchored pattern, so tests/cart/cart.spec.ts would also match tests/cart/cart.spec.tsx
 * and other/tests/cart/cart.spec.ts. The /pattern/ form with no flags is used as written: anchored at
 * both ends, case sensitive, with every special character escaped.
 */
function exactFile(escapedPath: string): string {
  return `/^${escapedPath}$/`;
}

/**
 * The Playwright arguments for a selection, without the CLI path, plus the same list for display with
 * the root shown as <root>. Null in mode none. Pure. The JSON report goes to the file named by
 * PLAYWRIGHT_JSON_OUTPUT_FILE, which the runner sets, so it is not an argument. --forbid-only is always
 * passed, so a focused test (.only) can never give Passed. In Playwright 1.60.0 the flag overrides the config's
 * forbidOnly (lib/common/index.js:564), and a focused test then becomes a top-level error in the JSON
 * report and exit code 1 (lib/runner/index.js:2436-2441).
 */
export function buildPlaywrightArgs(selection: Selection, root: string): { args: string[]; display: string[] } | null {
  if (selection.mode === 'none') return null;
  const options = ['--reporter=json', '--pass-with-no-tests', '--forbid-only'];
  const files = selection.mode === 'subset' ? selection.selected.map((spec) => spec.file).sort(compareText) : [];
  return {
    args: [
      'test', '--config', path.resolve(root, selection.playwrightDir), ...options,
      ...files.map((file) => exactFile(escapeRegExp(path.resolve(root, file)))),
    ],
    display: [
      'test', '--config', selection.playwrightDir, ...options,
      ...files.map((file) => exactFile(`${ROOT_PLACEHOLDER}/${escapeRegExp(file)}`)),
    ],
  };
}
