import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ImpactError, type ImpactConfig } from './types.js';

export const CONFIG_FILE = 'qa-core-prcheck.config.json';

const ALLOWED_KEYS = ['playwrightDir', 'areas', 'fullSuiteOn', 'ignore'];
const DEFAULT_PLAYWRIGHT_DIR = 'demo/saucedemo';

// Plain code unit order, so the result never depends on the machine locale.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function fail(message: string): never {
  throw new ImpactError(`${CONFIG_FILE}: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPlaywrightDir(value: unknown): string {
  if (typeof value !== 'string' || value === '') fail('"playwrightDir" must be a non-empty string');
  const slashed = value.replaceAll('\\', '/');
  if (path.posix.isAbsolute(slashed) || path.win32.isAbsolute(value)) {
    fail(`"playwrightDir" must be relative to the root, not absolute: ${value}`);
  }
  if (slashed.split('/').includes('..')) fail(`"playwrightDir" must not contain "..": ${value}`);
  // normalize strips ./ and doubled slashes; "." stays "." for a config at the root.
  const normalized = path.posix.normalize(slashed).replace(/\/+$/, '');
  return normalized === '' ? '.' : normalized;
}

function readAreas(value: unknown): ImpactConfig['areas'] {
  if (!isObject(value)) fail('"areas" must be an object that maps a glob to a list of tags');
  return Object.entries(value)
    .map(([glob, tags]) => {
      if (glob === '') fail('"areas" has an empty glob');
      const valid = Array.isArray(tags) && tags.length > 0
        && tags.every((tag) => typeof tag === 'string' && tag.startsWith('@'));
      if (!valid) fail(`"areas" value for "${glob}" must be a non-empty array of tags that start with @`);
      return { glob, tags: sortedUnique(tags as string[]) };
    })
    .sort((a, b) => compareText(a.glob, b.glob));
}

function readGlobList(key: 'fullSuiteOn' | 'ignore', value: unknown): string[] {
  const valid = Array.isArray(value) && value.every((glob) => typeof glob === 'string' && glob !== '');
  if (!valid) fail(`"${key}" must be an array of non-empty strings`);
  return sortedUnique(value as string[]);
}

/** Reads <root>/qa-core-prcheck.config.json, or returns the defaults when the file does not exist. */
export function loadConfig(root: string): ImpactConfig {
  const file = path.join(root, CONFIG_FILE);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { playwrightDir: DEFAULT_PLAYWRIGHT_DIR, areas: [], fullSuiteOn: [], ignore: [] };
    }
    throw new ImpactError(`Cannot read ${CONFIG_FILE}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ImpactError(`${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  if (!isObject(json)) fail('the top level must be a JSON object');
  for (const key of Object.keys(json)) {
    if (!ALLOWED_KEYS.includes(key)) fail(`unknown key "${key}". Allowed keys: ${ALLOWED_KEYS.join(', ')}`);
  }

  return {
    playwrightDir: 'playwrightDir' in json ? readPlaywrightDir(json.playwrightDir) : DEFAULT_PLAYWRIGHT_DIR,
    areas: 'areas' in json ? readAreas(json.areas) : [],
    fullSuiteOn: 'fullSuiteOn' in json ? readGlobList('fullSuiteOn', json.fullSuiteOn) : [],
    ignore: 'ignore' in json ? readGlobList('ignore', json.ignore) : [],
  };
}
