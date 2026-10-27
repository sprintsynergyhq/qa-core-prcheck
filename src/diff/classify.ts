// Built-in rules that give each changed path a file class. First match wins.
// 'other' means "unknown": PR 3 will treat unknown files as unmapped.

import type { FileClass } from './types.js';

const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']);
const PLAYWRIGHT_CONFIG = /^playwright(\..+)?\.config\.(ts|js|mjs|cjs|mts|cts)$/;
const SPEC = /\.(spec|test)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const TEST_DATA_DIRS = new Set(['fixtures', 'test-data', 'testdata']);
const DOCS_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst']);
const TEST_DIRS = new Set(['tests', 'test', 'e2e', '__tests__']);
const PAGE_OBJECT_DIRS = new Set(['pages', 'page-objects', 'helpers', 'support']);
const APP_SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.css', '.scss', '.html',
]);

// A leading dot (.nvmrc) starts a name, not an extension.
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

/** Classifies a repo-relative POSIX path. Pure: it never reads the filesystem. Case sensitive. */
export function classifyPath(path: string): FileClass {
  const dirs = path.split('/');
  const name = dirs.pop() ?? '';
  const extension = extensionOf(name);

  if (path.startsWith('.github/workflows/') || path.startsWith('.github/actions/')) return 'ci-workflow';
  if (LOCKFILES.has(name)) return 'lockfile';
  if (name === 'package.json') return 'package-manifest';
  if (PLAYWRIGHT_CONFIG.test(name)) return 'playwright-config';
  if (SPEC.test(name)) return 'spec';
  if (dirs.some((dir) => TEST_DATA_DIRS.has(dir))) return 'test-data';
  if (DOCS_EXTENSIONS.has(extension) || name.startsWith('LICENSE') || dirs[0] === 'docs') return 'docs';
  if (dirs.some((dir) => TEST_DIRS.has(dir))) return 'test-support';
  if (dirs.includes('demo') && dirs.some((dir) => PAGE_OBJECT_DIRS.has(dir))) return 'test-support';
  if (APP_SOURCE_EXTENSIONS.has(extension)) return 'app-source';
  return 'other';
}
