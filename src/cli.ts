#!/usr/bin/env node
// Exit codes:
//   0  ok; for run and check: every picked test passed, or nothing needed to run
//   1  a picked test failed (run and check)
//   2  usage or tool error

import path from 'node:path';
import { checkErrorLine, formatCheckJson, runCheck, type CheckResult } from './check/index.js';
import { DiffError, formatJson, formatText, readDiffFile, readGitDiff, type DiffResult } from './diff/index.js';
import { formatSelectionJson, formatSelectionText, ImpactError, selectTests, type Selection } from './impact/index.js';
import { InventoryError } from './inventory/index.js';
import { formatSummary, ReportError, writeSummaryFiles, type WrittenFiles } from './report/index.js';
import { formatRunJson, formatRunText, RunError, runSelected, type RunResult } from './run/index.js';
import { VERSION } from './version.js';

const USAGE = `qa-core-prcheck <command> [options]

Commands:
  diff            List the files changed between two git refs, or in a saved diff
  select          Pick the Playwright specs a change can affect (does not run them)
  run             Run the picked Playwright specs and report the results
  check           Pick, run and summarize: writes the Markdown summary for the PR

Options:
  -v, --version   Print the version
  -h, --help      Print this help

Run qa-core-prcheck <command> --help for the command options.
`;

const DIFF_USAGE = `qa-core-prcheck diff --base <ref> [--head <ref>] [--json]
qa-core-prcheck diff --diff-file <path> [--json]

Options:
  --base <ref>        Compare against the merge base of this ref and the head
  --head <ref>        The head ref (default: HEAD)
  --diff-file <path>  Read a saved unified git diff instead of running git
  --json              Print JSON instead of text
  -h, --help          Print this help

Exit codes: 0 ok, 2 usage or tool error. This command never exits 1.
`;

const SELECT_USAGE = `qa-core-prcheck select --base <ref> [--head <ref>] [--root <dir>] [--json]
qa-core-prcheck select --diff-file <path> [--root <dir>] [--json]

Picks the Playwright specs a change can affect. It does not run any test.

Options:
  --base <ref>        Compare against the merge base of this ref and the head
  --head <ref>        The head ref (default: HEAD)
  --diff-file <path>  Read a saved unified git diff instead of running git
  --root <dir>        The repository root (default: the current folder)
  --json              Print JSON instead of text
  -h, --help          Print this help

Reads qa-core-prcheck.config.json from the root when it exists.
Exit codes: 0 ok, 2 usage or tool error. This command never exits 1.
`;

const RUN_USAGE = `qa-core-prcheck run --base <ref> [--head <ref>] [--root <dir>] [--json] [--dry-run]
qa-core-prcheck run --diff-file <path> [--root <dir>] [--json] [--dry-run]

Picks the Playwright specs a change can affect, runs them and reports the results.

Options:
  --base <ref>        Compare against the merge base of this ref and the head
  --head <ref>        The head ref (default: HEAD)
  --diff-file <path>  Read a saved unified git diff instead of running git
  --root <dir>        The repository root (default: the current folder)
  --json              Print JSON instead of text
  --dry-run           Print the Playwright command without running it
  -h, --help          Print this help

Exit codes: 0 all picked tests passed or nothing to run, 1 a picked test failed, 2 usage or tool error.
`;

const CHECK_USAGE = `qa-core-prcheck check --base <ref> [--head <ref>] [--root <dir>] [--summary-file <path>] [--json] [--dry-run]
qa-core-prcheck check --diff-file <path> [--root <dir>] [--summary-file <path>] [--json] [--dry-run]

Picks the Playwright specs a change can affect, runs them and writes one Markdown summary.

Options:
  --base <ref>           Compare against the merge base of this ref and the head
  --head <ref>           The head ref (default: HEAD)
  --diff-file <path>     Read a saved unified git diff instead of running git
  --root <dir>           The repository root (default: the current folder)
  --summary-file <path>  Where to write the summary (default: prcheck-summary.md)
  --json                 Print JSON instead of the Markdown summary
  --dry-run              Build the command and summary without running tests or writing files
  -h, --help             Print this help

Also appends the summary to $GITHUB_STEP_SUMMARY when it is set.
Exit codes: 0 all picked tests passed or nothing to run, 1 a picked test failed, 2 usage or tool error.
`;

const DEFAULT_SUMMARY_FILE = 'prcheck-summary.md';

function usageError(arg: string): void {
  process.stderr.write(`Unknown argument: ${arg}\nRun qa-core-prcheck --help for usage.\n`);
  process.exitCode = 2;
}

function commandError(command: string, message: string): void {
  process.stderr.write(`${message}\nRun qa-core-prcheck ${command} --help for usage.\n`);
  process.exitCode = 2;
}

type DiffSourceRequest =
  | { source: 'git'; base: string; head: string | undefined }
  | { source: 'file'; diffFile: string };

interface ParsedArgs { values: Map<string, string>; json: boolean; dryRun: boolean }

const DIFF_OPTIONS = new Set(['--base', '--head', '--diff-file']);
const SELECT_OPTIONS = new Set([...DIFF_OPTIONS, '--root']);
const CHECK_OPTIONS = new Set([...SELECT_OPTIONS, '--summary-file']);

/**
 * Returns the values, or the message for the first problem found. Values follow their option; no = form.
 * --dry-run is a flag only where allowDryRun is set; elsewhere it is an unknown argument.
 */
function parseArgs(args: string[], valueOptions: Set<string>, allowDryRun = false): ParsedArgs | string {
  const values = new Map<string, string>();
  let json = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--json') {
      if (json) return 'Duplicate argument: --json';
      json = true;
    } else if (allowDryRun && arg === '--dry-run') {
      if (dryRun) return 'Duplicate argument: --dry-run';
      dryRun = true;
    } else if (valueOptions.has(arg)) {
      if (values.has(arg)) return `Duplicate argument: ${arg}`;
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) return `Missing value for ${arg}`;
      values.set(arg, value);
      i++;
    } else {
      return `Unknown argument: ${arg}`;
    }
  }
  return { values, json, dryRun };
}

/** Exactly one of --base and --diff-file, and --head only with --base. */
function diffSourceOf(values: Map<string, string>): DiffSourceRequest | string {
  const base = values.get('--base');
  const head = values.get('--head');
  const diffFile = values.get('--diff-file');
  if (base !== undefined && diffFile !== undefined) return 'Use either --base or --diff-file, not both';
  if (head !== undefined && base === undefined) return '--head can only be used with --base';
  if (base !== undefined) return { source: 'git', base, head };
  if (diffFile !== undefined) return { source: 'file', diffFile };
  return 'Missing required option: --base <ref> or --diff-file <path>';
}

/** Prints the command help for --help or -h as the only argument. True when the arguments were a help request. */
function handleHelp(command: string, usage: string, args: string[]): boolean {
  const [first, extra] = args;
  if (first !== '--help' && first !== '-h') return false;
  if (extra !== undefined) commandError(command, `Unknown argument: ${extra}`);
  else process.stdout.write(usage);
  return true;
}

function readDiff(request: DiffSourceRequest, cwd: string): Promise<DiffResult> {
  return request.source === 'git'
    ? readGitDiff({ base: request.base, head: request.head, cwd })
    : readDiffFile(request.diffFile);
}

async function runDiff(args: string[]): Promise<void> {
  if (handleHelp('diff', DIFF_USAGE, args)) return;

  const parsed = parseArgs(args, DIFF_OPTIONS);
  if (typeof parsed === 'string') return commandError('diff', parsed);
  const request = diffSourceOf(parsed.values);
  if (typeof request === 'string') return commandError('diff', request);

  let result: DiffResult;
  try {
    result = await readDiff(request, process.cwd());
  } catch (error) {
    if (error instanceof DiffError) return commandError('diff', error.message);
    throw error;
  }
  // Format first, then write once: stdout only gets output when everything worked.
  process.stdout.write(parsed.json ? formatJson(result) : formatText(result));
}

async function runSelect(args: string[]): Promise<void> {
  if (handleHelp('select', SELECT_USAGE, args)) return;

  const parsed = parseArgs(args, SELECT_OPTIONS);
  if (typeof parsed === 'string') return commandError('select', parsed);
  const request = diffSourceOf(parsed.values);
  if (typeof request === 'string') return commandError('select', request);
  const root = path.resolve(parsed.values.get('--root') ?? process.cwd());

  // The diff is read first, so a bad ref fails before Playwright runs. --diff-file is read from the current folder.
  let selection: Selection;
  try {
    const diff = await readDiff(request, root);
    selection = await selectTests({ root, diff });
  } catch (error) {
    if (error instanceof DiffError || error instanceof InventoryError || error instanceof ImpactError) {
      return commandError('select', error.message);
    }
    throw error;
  }
  process.stdout.write(parsed.json ? formatSelectionJson(selection) : formatSelectionText(selection));
}

async function runRun(args: string[]): Promise<void> {
  if (handleHelp('run', RUN_USAGE, args)) return;

  const parsed = parseArgs(args, SELECT_OPTIONS, true);
  if (typeof parsed === 'string') return commandError('run', parsed);
  const request = diffSourceOf(parsed.values);
  if (typeof request === 'string') return commandError('run', request);
  const root = path.resolve(parsed.values.get('--root') ?? process.cwd());

  // Problems before Playwright starts are typed errors and leave stdout empty, as for select.
  let result: RunResult;
  try {
    const diff = await readDiff(request, root);
    result = await runSelected({ root, diff, dryRun: parsed.dryRun });
  } catch (error) {
    if (error instanceof DiffError || error instanceof InventoryError || error instanceof ImpactError || error instanceof RunError) {
      return commandError('run', error.message);
    }
    throw error;
  }
  // Exit codes 0, 1 and 2 all print the result. For a runner error it carries every error, and the
  // first one also goes to stderr.
  process.stdout.write(parsed.json ? formatRunJson(result) : formatRunText(result));
  if (result.verdict === 'error' && result.errors.length > 0) process.stderr.write(`${result.errors[0]}\n`);
  process.exitCode = result.exitCode;
}

async function runCheckCommand(args: string[]): Promise<void> {
  if (handleHelp('check', CHECK_USAGE, args)) return;

  const parsed = parseArgs(args, CHECK_OPTIONS, true);
  if (typeof parsed === 'string') return commandError('check', parsed);
  const request = diffSourceOf(parsed.values);
  if (typeof request === 'string') return commandError('check', request);
  const root = path.resolve(parsed.values.get('--root') ?? process.cwd());
  // Read from the current folder, as --diff-file is.
  const summaryFile = path.resolve(parsed.values.get('--summary-file') ?? DEFAULT_SUMMARY_FILE);

  let checked: CheckResult;
  try {
    const diff = await readDiff(request, root);
    checked = await runCheck({ root, diff, dryRun: parsed.dryRun, version: VERSION });
  } catch (error) {
    if (!(error instanceof DiffError || error instanceof InventoryError || error instanceof ImpactError || error instanceof RunError)) {
      throw error;
    }
    // Stopped before the run: the message goes to stderr and stdout stays empty, as for run. The
    // summary still says so, except in a dry run, which never writes.
    commandError('check', error.message);
    if (parsed.dryRun) return;
    const summary = formatSummary({ selection: null, result: null, error: checkErrorLine(error.message, root), version: VERSION });
    try {
      await writeSummaryFiles({ summary: summary.markdown, summaryFile, selection: null, result: null, env: process.env });
    } catch (writeError) {
      if (!(writeError instanceof ReportError)) throw writeError;
      process.stderr.write(`${writeError.message}\n`);
    }
    return;
  }

  // Exit codes 0, 1 and 2 from the run all print the summary. A write failure still prints it and exits 2.
  const { selection, result, summary } = checked;
  let files: WrittenFiles | null = null;
  let writeFailure: string | null = null;
  if (!parsed.dryRun) {
    try {
      files = await writeSummaryFiles({ summary: summary.markdown, summaryFile, selection, result, env: process.env });
    } catch (error) {
      if (!(error instanceof ReportError)) throw error;
      writeFailure = error.message;
    }
  }
  const exitCode = writeFailure === null ? result.exitCode : 2;
  process.stdout.write(parsed.json ? formatCheckJson(selection, result, summary, files, exitCode) : summary.markdown);
  if (result.verdict === 'error' && result.errors.length > 0) process.stderr.write(`${result.errors[0]}\n`);
  if (writeFailure !== null) process.stderr.write(`${writeFailure}\n`);
  process.exitCode = exitCode;
}

async function main(args: string[]): Promise<void> {
  const [first, extra] = args;

  if (first === 'diff') return runDiff(args.slice(1));
  if (first === 'select') return runSelect(args.slice(1));
  if (first === 'run') return runRun(args.slice(1));
  if (first === 'check') return runCheckCommand(args.slice(1));

  if (first === undefined || first === '--help' || first === '-h') {
    if (extra !== undefined) return usageError(extra);
    process.stdout.write(USAGE);
    return;
  }

  if (first === '--version' || first === '-v') {
    if (extra !== undefined) return usageError(extra);
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  usageError(first);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
