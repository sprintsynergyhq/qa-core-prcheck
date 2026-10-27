#!/usr/bin/env node
// Exit codes:
//   0  ok
//   2  usage error (unknown or extra argument)
// Code 1 is reserved for failing tests in later releases.

import { VERSION } from './version.js';

const USAGE = `qa-core-prcheck <option>

Options:
  -v, --version   Print the version
  -h, --help      Print this help

Commands such as diff, select, run and check arrive in later releases.
`;

function usageError(arg: string): void {
  process.stderr.write(`Unknown argument: ${arg}\nRun qa-core-prcheck --help for usage.\n`);
  process.exitCode = 2;
}

function main(args: string[]): void {
  const [first, extra] = args;

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

main(process.argv.slice(2));
