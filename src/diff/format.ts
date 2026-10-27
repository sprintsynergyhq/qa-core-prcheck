import type { ChangedFile, DiffResult } from './types.js';

/** The documented JSON shape: keys in the order of the types in types.ts. */
export function formatJson(result: DiffResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function label(file: ChangedFile): string {
  return file.oldPath === null ? file.path : `${file.oldPath} -> ${file.path}`;
}

function stats(file: ChangedFile): string {
  return file.binary ? 'binary' : `+${file.additions} -${file.deletions}`;
}

/** One line per file, in result order, after an optional merge base line and the count. */
export function formatText(result: DiffResult): string {
  const lines: string[] = [];
  if (result.source.type === 'git') lines.push(`Merge base: ${result.source.mergeBaseSha}`);
  lines.push(`Changed files: ${result.files.length}`);
  for (const file of result.files) {
    lines.push([file.status.padEnd(8), label(file), stats(file), file.fileClass].join('  '));
  }
  return `${lines.join('\n')}\n`;
}
