import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ChangedFile, DiffResult } from '../diff/index.js';
import { readInventory } from '../inventory/index.js';
import { loadConfig } from './config.js';
import { buildImportGraph, type ImportGraph } from './graph.js';
import { importersOf, mapImpact } from './map.js';
import { ImpactError, type Selection } from './types.js';

export interface SelectOptions {
  root: string;                  // absolute repository root; diff paths are relative to it
  diff: DiffResult;
  env?: NodeJS.ProcessEnv;       // merged over process.env for the Playwright run
  removeEnv?: readonly string[]; // env var names taken out of the Playwright env (check: the LLM key env var)
}

// The order Playwright 1.60.0 itself uses to find the config file in a folder,
// so the import graph starts from the same file Playwright loads.
const CONFIG_NAMES = [
  'playwright.config.ts', 'playwright.config.js', 'playwright.config.mts',
  'playwright.config.mjs', 'playwright.config.cts', 'playwright.config.cjs',
];

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * The texts the unused member suggestion reads, from root: each changed test-support file with added
 * lines that the import graph holds, and every file that reaches it. A file that cannot be read is
 * left out, so it gets no member suggestion; the graph has already warned about it.
 */
function readMemberTexts(root: string, graph: ImportGraph, files: ChangedFile[]): Map<string, string> {
  const wanted = new Set<string>();
  for (const file of files) {
    if (file.fileClass !== 'test-support' || file.status === 'deleted' || file.ranges.length === 0) continue;
    if (!graph.imports.has(file.path)) continue;
    for (const needed of [file.path, ...importersOf(graph, file.path)]) wanted.add(needed);
  }
  const texts = new Map<string, string>();
  for (const file of wanted) {
    try {
      texts.set(file, readFileSync(path.join(root, ...file.split('/')), 'utf8'));
    } catch {
      // Left out on purpose: see above.
    }
  }
  return texts;
}

/**
 * Picks the Playwright specs the diff can affect. In order: the root, the config file, the
 * Playwright folder and its config file, then the inventory (the only step that runs Playwright),
 * the import graph, the file texts for the member suggestions and the rules.
 */
export async function selectTests(options: SelectOptions): Promise<Selection> {
  const { root, diff } = options;
  if (!isDirectory(root)) throw new ImpactError(`Root folder not found: ${root}`);
  const config = loadConfig(root);

  const playwrightDir = config.playwrightDir;
  if (!isDirectory(path.join(root, playwrightDir))) throw new ImpactError(`Playwright folder not found: ${playwrightDir}`);
  const configName = CONFIG_NAMES.find((name) => isFile(path.join(root, playwrightDir, name)));
  if (configName === undefined) throw new ImpactError(`No Playwright config found in ${playwrightDir}`);
  const configEntry = path.posix.join(playwrightDir, configName);

  const inventory = await readInventory(root, playwrightDir, options.env, options.removeEnv);
  const graph = buildImportGraph(root, [...inventory.specs.map((spec) => spec.file), configEntry]);
  const texts = readMemberTexts(root, graph, diff.files);
  return mapImpact({ source: diff.source, files: diff.files, inventory, graph, configEntry, config, texts });
}
