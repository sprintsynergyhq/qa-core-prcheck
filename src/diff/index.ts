import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseUnifiedDiff } from './parse.js';
import { DiffError, type DiffResult } from './types.js';

export type { ChangeStatus, ChangedFile, DiffResult, DiffSource, FileClass, LineRange } from './types.js';
export { DiffError } from './types.js';
export { classifyPath } from './classify.js';
export { parseUnifiedDiff } from './parse.js';
export { readGitDiff, type ReadGitDiffOptions } from './git.js';
export { formatJson, formatText } from './format.js';

/** Reads a saved unified git diff. A relative filePath is read from cwd (default process.cwd()). */
export async function readDiffFile(filePath: string, cwd: string = process.cwd()): Promise<DiffResult> {
  let text: string;
  try {
    text = await readFile(resolve(cwd, filePath), 'utf8');
  } catch {
    throw new DiffError(`Cannot read diff file: ${filePath}`);
  }
  return { schemaVersion: 1, source: { type: 'file', path: filePath }, files: parseUnifiedDiff(text) };
}
