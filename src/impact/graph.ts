// A static import graph, walked breadth first from the entry files through relative imports.
// Only relative specifiers are followed: bare ones (@playwright/test, node:fs) are ignored, and so are
// tsconfig paths and package aliases. import(name) with a non-literal argument cannot be seen.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { findImportSpecifiers } from './imports.js';

export interface ImportGraph {
  /** file -> repo-relative files it imports (resolved), sorted. Only files reached from an entry. */
  imports: Map<string, string[]>;
  /** file -> files that import it, sorted. */
  importedBy: Map<string, string[]>;
  warnings: string[];
}

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const RESOLVE_EXTENSIONS = [...SCRIPT_EXTENSIONS, '.json'];
// A .js specifier may name a .ts source file: TypeScript and Playwright both resolve it that way.
const SOURCE_EXTENSIONS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'], '.jsx': ['.tsx'],
};
// Never read, at any depth: VCS data, installs and generated output.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'test-results', 'playwright-report', 'blob-report']);

// Plain code unit order, so the result never depends on the machine locale.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRelative(specifier: string): boolean {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

function isScript(file: string): boolean {
  return SCRIPT_EXTENSIONS.includes(path.posix.extname(file));
}

function leavesRoot(relative: string): boolean {
  return relative === '..' || relative.startsWith('../') || path.isAbsolute(relative);
}

/** The candidate paths for a specifier joined to its folder, in resolution order. */
function candidates(joined: string, specifier: string): string[] {
  const index = RESOLVE_EXTENSIONS.map((extension) => `${joined}/index${extension}`);
  // ".", ".." and "./pages/" name a folder, so only its index file can match.
  if (specifier === '.' || specifier === '..' || specifier.endsWith('/')) return index;
  const extension = path.posix.extname(joined);
  const swapped = (SOURCE_EXTENSIONS[extension] ?? []).map((source) => joined.slice(0, -extension.length) + source);
  return [joined, ...swapped, ...RESOLVE_EXTENSIONS.map((added) => joined + added), ...index];
}

type Resolution =
  | { kind: 'file'; file: string }
  | { kind: 'unresolved' }
  | { kind: 'outside' }
  | { kind: 'skipped' };

class GraphBuilder {
  private readonly realRoot: string;
  readonly imports = new Map<string, string[]>();
  readonly warnings = new Set<string>();

  constructor(private readonly root: string) {
    this.realRoot = realpathSync(root);
  }

  /** Where a candidate really is, as a repo-relative POSIX path, or why it cannot be used. Follows symlinks. */
  private locate(candidate: string): Resolution | null {
    const full = path.join(this.root, ...candidate.split('/'));
    let real: string;
    try {
      if (!statSync(full).isFile()) return null;
      real = realpathSync(full);
    } catch {
      return null;
    }
    const relative = path.relative(this.realRoot, real).split(path.sep).join('/');
    if (leavesRoot(relative)) return { kind: 'outside' };
    if (relative.split('/').some((dir) => SKIP_DIRS.has(dir))) return { kind: 'skipped' };
    return { kind: 'file', file: relative };
  }

  resolve(from: string, specifier: string): Resolution {
    const joined = path.posix.join(path.posix.dirname(from), specifier).replace(/\/$/, '');
    if (leavesRoot(joined)) return { kind: 'outside' };
    if (joined.split('/').some((dir) => SKIP_DIRS.has(dir))) return { kind: 'skipped' };
    for (const candidate of candidates(joined, specifier)) {
      const found = this.locate(candidate);
      if (found !== null) return found;
    }
    return { kind: 'unresolved' };
  }

  /** The resolved relative imports of one file. A file that is not a script is a leaf and is not read. */
  importsOf(file: string): string[] | null {
    if (!isScript(file)) return [];
    let source: string;
    try {
      source = readFileSync(path.join(this.root, ...file.split('/')), 'utf8');
    } catch {
      this.warnings.add(`Cannot read ${file}`);
      return null;
    }
    const found = new Set<string>();
    for (const specifier of findImportSpecifiers(source)) {
      if (!isRelative(specifier)) continue;
      const resolution = this.resolve(file, specifier);
      if (resolution.kind === 'file') found.add(resolution.file);
      else if (resolution.kind === 'unresolved') this.warnings.add(`Unresolved import "${specifier}" in ${file}`);
      else if (resolution.kind === 'outside') this.warnings.add(`Import outside the repository ignored: "${specifier}" in ${file}`);
    }
    return [...found].sort(compareText);
  }
}

/**
 * Builds the import graph from the entry files (repo-relative POSIX paths), breadth first.
 * Every path in the graph is repo-relative POSIX. A cycle is walked once.
 */
export function buildImportGraph(root: string, entries: string[]): ImportGraph {
  const builder = new GraphBuilder(root);
  const queue = [...new Set(entries)];
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i]!;
    const imports = builder.importsOf(file);
    if (imports === null) continue;
    builder.imports.set(file, imports);
    for (const next of imports) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  const files = [...builder.imports.keys()].sort(compareText);
  const importedBy = new Map<string, string[]>();
  for (const file of files) {
    for (const imported of builder.imports.get(file)!) {
      const importers = importedBy.get(imported) ?? [];
      importers.push(file);
      importedBy.set(imported, importers);
    }
  }
  return {
    imports: new Map(files.map((file) => [file, builder.imports.get(file)!])),
    importedBy: new Map([...importedBy.keys()].sort(compareText).map((file) => [file, importedBy.get(file)!])),
    warnings: [...builder.warnings].sort(compareText),
  };
}
