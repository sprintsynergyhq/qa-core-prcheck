import { classifyPath } from './classify.js';
import { DiffError, type ChangeStatus, type ChangedFile, type LineRange } from './types.js';

// Counts are optional and default to 1, and text may follow the second @@: "@@ -2 +2 @@ a".
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const SIMILARITY = /^similarity index (\d+)%$/;

/** What the header lines of one "diff --git" block say, before its first hunk. */
interface BlockHeader {
  gitLine: string;
  renameFrom: string | null;
  renameTo: string | null;
  copyFrom: string | null;
  copyTo: string | null;
  similarity: number | null;
  /** From the --- and +++ lines: undefined when the line is absent, null for /dev/null. */
  minusPath: string | null | undefined;
  plusPath: string | null | undefined;
  newFile: boolean;
  deletedFile: boolean;
  binary: boolean;
}

const OCTAL_DIGITS = /^[0-7]{3}$/;
const SIMPLE_ESCAPES: Record<string, number> = {
  '"': 0x22, '\\': 0x5c, a: 0x07, b: 0x08, t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d,
};

/**
 * Reads a C-style quoted string that git writes for paths with special characters,
 * starting at the opening quote. Octal escapes are bytes, so the result is decoded as UTF-8.
 */
function readQuoted(text: string, start: number): { value: string; end: number } {
  const bytes: number[] = [];
  let i = start + 1;
  while (i < text.length) {
    const char = text[i]!;
    if (char === '"') return { value: Buffer.from(bytes).toString('utf8'), end: i + 1 };
    if (char === '\\') {
      const octal = text.slice(i + 1, i + 4);
      const simple = SIMPLE_ESCAPES[text[i + 1] ?? ''];
      if (OCTAL_DIGITS.test(octal)) {
        bytes.push(parseInt(octal, 8));
        i += 4;
      } else if (simple !== undefined) {
        bytes.push(simple);
        i += 2;
      } else {
        throw new DiffError(`Cannot read the quoted path: ${text}`);
      }
      continue;
    }
    const codePoint = text.codePointAt(i)!;
    const piece = String.fromCodePoint(codePoint);
    bytes.push(...Buffer.from(piece, 'utf8'));
    i += piece.length;
  }
  throw new DiffError(`Cannot read the quoted path: ${text}`);
}

function unquote(raw: string): string {
  if (!raw.startsWith('"')) return raw;
  const { value, end } = readQuoted(raw, 0);
  if (end !== raw.length) throw new DiffError(`Cannot read the quoted path: ${raw}`);
  return value;
}

function stripPrefix(path: string, prefix: 'a/' | 'b/', line: string): string {
  if (!path.startsWith(prefix)) throw new DiffError(`Expected the a/ and b/ path prefixes in: ${line}`);
  return path.slice(prefix.length);
}

/** Path from a --- or +++ line, or null for /dev/null. */
function headerPath(raw: string, prefix: 'a/' | 'b/', line: string): string | null {
  // git ends a path that holds a space with one TAB on these lines.
  const value = raw.endsWith('\t') ? raw.slice(0, -1) : raw;
  if (value === '/dev/null') return null;
  return stripPrefix(unquote(value), prefix, line);
}

/**
 * Path from "diff --git a/<p> b/<p>", used only when no other line names the file
 * (binary files, mode-only changes, empty new or deleted files). Both sides hold the same path.
 */
function pathFromGitLine(line: string): string {
  const both = line.slice('diff --git '.length);
  let oldPath: string;
  let newPath: string;
  if (both.startsWith('"')) {
    const first = readQuoted(both, 0);
    if (both[first.end] !== ' ') throw new DiffError(`Cannot read the paths in: ${line}`);
    oldPath = stripPrefix(first.value, 'a/', line);
    newPath = stripPrefix(unquote(both.slice(first.end + 1)), 'b/', line);
  } else {
    // After "diff --git a/" the rest is "<p> b/<p>", so <p> has length (rest.length - 3) / 2.
    const rest = stripPrefix(both, 'a/', line);
    const length = (rest.length - 3) / 2;
    if (!Number.isInteger(length) || length < 1 || rest.slice(length, length + 3) !== ' b/') {
      throw new DiffError(`Cannot read the paths in: ${line}`);
    }
    oldPath = rest.slice(0, length);
    newPath = rest.slice(length + 3);
  }
  if (oldPath !== newPath) throw new DiffError(`Cannot read the paths in: ${line}`);
  return newPath;
}

function readHeaderLine(header: BlockHeader, line: string): void {
  if (line.startsWith('rename from ')) header.renameFrom = unquote(line.slice('rename from '.length));
  else if (line.startsWith('rename to ')) header.renameTo = unquote(line.slice('rename to '.length));
  else if (line.startsWith('copy from ')) header.copyFrom = unquote(line.slice('copy from '.length));
  else if (line.startsWith('copy to ')) header.copyTo = unquote(line.slice('copy to '.length));
  else if (line.startsWith('similarity index ')) {
    const match = line.match(SIMILARITY);
    if (match) header.similarity = Number(match[1]);
  } else if (line.startsWith('new file mode')) header.newFile = true;
  else if (line.startsWith('deleted file mode')) header.deletedFile = true;
  else if (line.startsWith('--- ')) header.minusPath = headerPath(line.slice(4), 'a/', line);
  else if (line.startsWith('+++ ')) header.plusPath = headerPath(line.slice(4), 'b/', line);
  else if (line.startsWith('Binary files ') || line === 'GIT binary patch') header.binary = true;
  // Other lines (index, old mode, new mode, dissimilarity index, ...) do not change the result.
}

/** Works out path, old path and status, in the order that stays correct for paths with spaces. */
function startFile(header: BlockHeader): ChangedFile {
  let path: string;
  let oldPath: string | null = null;
  let status: ChangeStatus;

  const moved = header.renameFrom !== null || header.renameTo !== null
    ? { from: header.renameFrom, to: header.renameTo, status: 'renamed' as const }
    : header.copyFrom !== null || header.copyTo !== null
      ? { from: header.copyFrom, to: header.copyTo, status: 'copied' as const }
      : null;

  if (moved) {
    if (moved.from === null || moved.to === null) throw new DiffError(`Missing ${moved.status} source or target in: ${header.gitLine}`);
    path = moved.to;
    oldPath = moved.from;
    status = moved.status;
  } else if (header.minusPath !== undefined || header.plusPath !== undefined) {
    if (header.minusPath === null && header.plusPath === null) throw new DiffError(`Both sides are /dev/null in: ${header.gitLine}`);
    if (header.minusPath === null) status = 'added';
    else if (header.plusPath === null) status = 'deleted';
    else status = 'modified';
    const named = status === 'deleted' ? header.minusPath : header.plusPath ?? header.minusPath;
    if (typeof named !== 'string') throw new DiffError(`Cannot read the paths in: ${header.gitLine}`);
    path = named;
  } else {
    path = pathFromGitLine(header.gitLine);
    status = header.newFile ? 'added' : header.deletedFile ? 'deleted' : 'modified';
  }

  return {
    path,
    oldPath,
    status,
    similarity: moved ? header.similarity : null,
    binary: header.binary,
    additions: 0,
    deletions: 0,
    ranges: [],
    fileClass: classifyPath(path),
  };
}

function addLine(ranges: LineRange[], line: number): void {
  const last = ranges[ranges.length - 1];
  if (last && last.end + 1 === line) last.end = line;
  else ranges.push({ start: line, end: line });
}

/** Sorts ranges and merges the ones that touch or overlap. */
function mergeRanges(ranges: LineRange[]): LineRange[] {
  const merged: LineRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/**
 * Reads one hunk starting at its header line and returns the index after it.
 * Inside a hunk every line is content, whatever it looks like, until both counts are used up.
 */
function readHunk(lines: string[], start: number, file: ChangedFile): number {
  const match = lines[start]!.match(HUNK_HEADER);
  if (!match) throw new DiffError(`Malformed hunk header on line ${start + 1} in ${file.path}`);
  let oldLeft = match[2] === undefined ? 1 : Number(match[2]);
  let newLeft = match[4] === undefined ? 1 : Number(match[4]);
  let newLine = Number(match[3]);

  let i = start + 1;
  while (oldLeft > 0 || newLeft > 0) {
    if (i >= lines.length) throw new DiffError(`The diff ends inside a hunk of ${file.path}`);
    const line = lines[i]!;
    const kind = line === '' ? ' ' : line[0];
    if (kind === '\\') {
      // "\ No newline at end of file" belongs to the line before it and counts for nothing.
    } else if (kind === '+' && newLeft > 0) {
      file.additions += 1;
      addLine(file.ranges, newLine);
      newLine += 1;
      newLeft -= 1;
    } else if (kind === '-' && oldLeft > 0) {
      file.deletions += 1;
      oldLeft -= 1;
    } else if (kind === ' ' && oldLeft > 0 && newLeft > 0) {
      // Some tools strip the single space of an empty context line, so '' is context too.
      newLine += 1;
      oldLeft -= 1;
      newLeft -= 1;
    } else {
      throw new DiffError(`Unexpected line ${i + 1} inside a hunk of ${file.path}`);
    }
    i += 1;
  }
  return i;
}

const isCombined = (line: string): boolean => line.startsWith('diff --cc ') || line.startsWith('diff --combined ');

// Plain code unit order, so the result never depends on the machine locale.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Parses the text of a git unified diff (a/ and b/ prefixes) into a sorted list of changed files. */
export function parseUnifiedDiff(text: string): ChangedFile[] {
  if (text.trim() === '') return [];

  const lines = text.split('\n');
  // The final newline ends the last line; it is not an empty line of its own.
  if (lines[lines.length - 1] === '') lines.pop();

  const files: ChangedFile[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isCombined(line)) throw new DiffError('Combined diffs (diff --cc) are not supported');
    if (!line.startsWith('diff --git ')) {
      i += 1;
      continue;
    }

    const header: BlockHeader = {
      gitLine: line, renameFrom: null, renameTo: null, copyFrom: null, copyTo: null, similarity: null,
      minusPath: undefined, plusPath: undefined, newFile: false, deletedFile: false, binary: false,
    };
    i += 1;
    while (i < lines.length && !lines[i]!.startsWith('@@') && !lines[i]!.startsWith('diff ')) {
      readHeaderLine(header, lines[i]!);
      i += 1;
    }

    const file = startFile(header);
    while (i < lines.length && !lines[i]!.startsWith('diff ')) {
      if (lines[i]!.startsWith('@@')) i = readHunk(lines, i, file);
      else i += 1; // a "\ No newline" marker after the last hunk line, or a line the parser does not need
    }

    if (file.binary) {
      file.additions = 0;
      file.deletions = 0;
      file.ranges = [];
    }
    file.ranges = mergeRanges(file.ranges);
    files.push(file);
  }

  if (files.length === 0) throw new DiffError('Input is not a git unified diff');
  return files.sort((a, b) => compareText(a.path, b.path) || compareText(a.oldPath ?? '', b.oldPath ?? ''));
}
