#!/usr/bin/env node
// Exit codes:
//   0  ok
//   2  usage or tool error
// Code 1 is reserved for failing tests in later releases.

import { DiffError, formatJson, formatText, readDiffFile, readGitDiff, type DiffResult } from './diff/index.js';
import { VERSION } from './version.js';

const USAGE = `qa-core-prcheck <command> [options]

Commands:
  diff            List the files changed between two git refs, or in a saved diff

Options:
  -v, --version   Print the version
  -h, --help      Print this help

Run qa-core-prcheck diff --help for the diff options.
Commands such as select, run and check arrive in later releases.
`;

const DIFF_USAGE = `qa-core-prcheck diff --base <ref> [--head <ref>] [--json]
qa-core-prcheck diff --diff-file <path> [--json]

Options:
  --base <ref>        Compare against the merge base of this ref and the head
  --head <ref>        The head ref (default: HEAD)
  --diff-file <path>  Read a saved unified git diff instead of running git
  --json              Print JSON instead of text
  -h, --help          Print this help

Exit codes: 0 ok, 2 usage or tool error. Code 1 is reserved.
`;

function usageError(arg: string): void {
  process.stderr.write(`Unknown argument: ${arg}\nRun qa-core-prcheck --help for usage.\n`);
  process.exitCode = 2;
}

function diffError(message: string): void {
  process.stderr.write(`${message}\nRun qa-core-prcheck diff --help for usage.\n`);
  process.exitCode = 2;
}

type DiffRequest =
  | { source: 'git'; base: string; head: string | undefined; json: boolean }
  | { source: 'file'; diffFile: string; json: boolean };

const VALUE_OPTIONS = new Set(['--base', '--head', '--diff-file']);

/** Returns the request, or the message for the first problem found. Values follow their option; no = form. */
function parseDiffArgs(args: string[]): DiffRequest | string {
  const values = new Map<string, string>();
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--json') {
      if (json) return 'Duplicate argument: --json';
      json = true;
    } else if (VALUE_OPTIONS.has(arg)) {
      if (values.has(arg)) return `Duplicate argument: ${arg}`;
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) return `Missing value for ${arg}`;
      values.set(arg, value);
      i++;
    } else {
      return `Unknown argument: ${arg}`;
    }
  }

  const base = values.get('--base');
  const head = values.get('--head');
  const diffFile = values.get('--diff-file');
  if (base !== undefined && diffFile !== undefined) return 'Use either --base or --diff-file, not both';
  if (head !== undefined && base === undefined) return '--head can only be used with --base';
  if (base !== undefined) return { source: 'git', base, head, json };
  if (diffFile !== undefined) return { source: 'file', diffFile, json };
  return 'Missing required option: --base <ref> or --diff-file <path>';
}

async function runDiff(args: string[]): Promise<void> {
  const [first, extra] = args;
  if (first === '--help' || first === '-h') {
    if (extra !== undefined) return diffError(`Unknown argument: ${extra}`);
    process.stdout.write(DIFF_USAGE);
    return;
  }

  const request = parseDiffArgs(args);
  if (typeof request === 'string') return diffError(request);

  let result: DiffResult;
  try {
    result = request.source === 'git'
      ? await readGitDiff({ base: request.base, head: request.head })
      : await readDiffFile(request.diffFile);
  } catch (error) {
    if (error instanceof DiffError) return diffError(error.message);
    throw error;
  }
  // Format first, then write once: stdout only gets output when everything worked.
  process.stdout.write(request.json ? formatJson(result) : formatText(result));
}

async function main(args: string[]): Promise<void> {
  const [first, extra] = args;

  if (first === 'diff') return runDiff(args.slice(1));

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
