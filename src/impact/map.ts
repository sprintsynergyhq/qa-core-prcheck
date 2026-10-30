// The impact mapper: a pure function from the changed files, the inventory, the import graph and the
// config to a Selection. It never reads the disk. Each changed file goes through the rules below in
// order, and the first rule that matches decides it. A renamed file's old path is a second changed
// file with status deleted.
//
//   1  Ignore             the path matches an ignore glob                        ignored
//   2  Full suite trigger  config, manifest, lockfile, CI file, or fullSuiteOn    full
//   3  Changed spec       a spec in the inventory that still exists              the spec and every spec that imports it
//   4  Config import      reached from the Playwright config                     full
//   5  Spec import        reached from one or more specs                         those specs
//   6  Deleted support    a deleted or renamed-away support or data file         full
//   7  Spec class         a spec file Playwright does not list (deleted, renamed  none
//                         away or never listed), each with its own reason
//   8  Unreached support  a support or data script no spec imports               none
//   9  Areas              matches an area glob                                   the specs with its tags
//   10 Docs               documentation                                          none
//   11 Unmapped           anything else                                          full
//
// After the rules, suggestTests (src/suggest/) reads each decision with the rule that made it and adds
// the missing test suggestions. They never change a decision, a selected spec or the mode.

import {
  classifyPath, type ChangeStatus, type ChangedFile, type DiffSource, type FileClass, type LineRange,
} from '../diff/index.js';
import type { Inventory, InventorySpec } from '../inventory/index.js';
import { suggestTests, type SuggestEntry } from '../suggest/index.js';
import { matchesGlob } from './glob.js';
import type { ImportGraph } from './graph.js';
import type { FileDecision, ImpactConfig, SelectedSpec, Selection, SelectionMode } from './types.js';

export interface MapInput {
  source: DiffSource;
  files: ChangedFile[];
  inventory: Inventory;
  graph: ImportGraph;
  configEntry: string | null;      // repo-relative path of the Playwright config file
  config: ImpactConfig;
  texts: ReadonlyMap<string, string>;  // file texts for the unused member suggestion, read by selectTests
}

const FULL_SUITE_CLASSES: Partial<Record<FileClass, string>> = {
  'playwright-config': 'Playwright config',
  'package-manifest': 'Package manifest',
  lockfile: 'Lockfile',
  'ci-workflow': 'CI workflow',
};
const SCRIPT_EXTENSION = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const FULL_SUITE_RUN = 'Part of the full suite run';

// Plain code unit order, so the result never depends on the machine locale.
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The reason rule 7 gives a deleted spec. formatSummary matches it exactly to find deleted specs. */
export function deletedSpecReason(path: string): string {
  return `Spec deleted, nothing to run: ${path}`;
}

/** The reason rule 7 gives the old path of a renamed spec, so a rename never reads as a deletion. */
export function renamedSpecReason(oldPath: string, newPath: string): string {
  return `Spec renamed: ${oldPath} to ${newPath}`;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function compareLists(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareText(a[i]!, b[i]!);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}

/** One changed path, as the rules see it. */
interface Change {
  path: string;
  status: ChangeStatus;
  fileClass: FileClass;
  /** The new path of a rename, set only on the entry for its old path. */
  renamedTo: string | null;
}

/** A decision plus the reason each spec it selects was picked. */
interface Outcome {
  decision: FileDecision;
  picks: Map<string, string>;
  rule: number;
  /** Rule 9 with outcome full only: the first matching area and its first tag, as its reason names them. */
  area: { glob: string; tag: string } | null;
}

/** Every file that reaches file through one or more imports, specs included, sorted. */
export function importersOf(graph: ImportGraph, file: string): string[] {
  const seen = new Set([file]);
  const queue = [file];
  for (let i = 0; i < queue.length; i++) {
    for (const importer of graph.importedBy.get(queue[i]!) ?? []) {
      if (!seen.has(importer)) {
        seen.add(importer);
        queue.push(importer);
      }
    }
  }
  seen.delete(file);
  return [...seen].sort(compareText);
}

/** Every file reached from start through one or more imports. */
function reachedFrom(graph: ImportGraph, start: string): Set<string> {
  const reached = new Set<string>();
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const next of graph.imports.get(queue[i]!) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
}

/**
 * The shortest import path from spec to target, without the two ends. Among several shortest paths,
 * the one that sorts first: a breadth first walk over sorted imports keeps the first parent it finds,
 * which is that path. Null when spec does not reach target.
 */
function shortestChain(graph: ImportGraph, spec: string, target: string): string[] | null {
  const parent = new Map<string, string>();
  const queue = [spec];
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i]!;
    for (const next of graph.imports.get(file) ?? []) {
      if (next === spec || parent.has(next)) continue;
      parent.set(next, file);
      if (next === target) {
        const chain: string[] = [];
        for (let step = parent.get(target)!; step !== spec; step = parent.get(step)!) chain.unshift(step);
        return chain;
      }
      queue.push(next);
    }
  }
  return null;
}

class Mapper {
  private readonly specFiles: Set<string>;
  private readonly specTags = new Map<string, Set<string>>();
  private readonly configReach: Set<string>;

  constructor(private readonly input: MapInput) {
    this.specFiles = new Set(input.inventory.specs.map((spec) => spec.file));
    for (const spec of input.inventory.specs) {
      this.specTags.set(spec.file, new Set(spec.tests.flatMap((t) => t.tags)));
    }
    this.configReach = input.configEntry === null ? new Set() : reachedFrom(input.graph, input.configEntry);
    if (input.configEntry !== null) this.configReach.delete(input.configEntry);
  }

  /** The inventory specs that reach file through one or more imports, sorted. */
  private specsReaching(file: string): string[] {
    return importersOf(this.input.graph, file).filter((f) => this.specFiles.has(f));
  }

  private importReason(file: string, spec: string): string {
    const chain = shortestChain(this.input.graph, spec, file) ?? [];
    return chain.length === 0
      ? `${file} is imported by ${spec}`
      : `${file} is imported by ${spec} through ${chain.join(' -> ')}`;
  }

  private importPicks(file: string, specs: string[]): Map<string, string> {
    return new Map(specs.map((spec) => [spec, this.importReason(file, spec)]));
  }

  decide(change: Change, renamedToHasImporters: boolean): Outcome {
    const { path: p, status, fileClass } = change;
    const { config, graph } = this.input;
    const make = (
      rule: number, outcome: FileDecision['outcome'], reason: string, picks = new Map<string, string>(), area: Outcome['area'] = null,
    ): Outcome => ({
      decision: { path: p, fileClass, status, outcome, reason, specs: [...picks.keys()].sort(compareText) },
      picks,
      rule,
      area,
    });
    const supportOrData = fileClass === 'test-support' || fileClass === 'test-data';

    // 1. Ignore beats everything, including a lockfile.
    const ignoredBy = config.ignore.find((glob) => matchesGlob(glob, p));
    if (ignoredBy !== undefined) return make(1, 'ignored', `Ignored by pattern "${ignoredBy}"`);

    // 2. Full suite triggers.
    const label = FULL_SUITE_CLASSES[fileClass];
    if (label !== undefined) return make(2, 'full', `${label} changed: ${p}`);
    const fullOn = config.fullSuiteOn.find((glob) => matchesGlob(glob, p));
    if (fullOn !== undefined) return make(2, 'full', `${p} matches fullSuiteOn pattern "${fullOn}"`);

    // 3. A changed spec selects itself and every spec that imports it.
    if (this.specFiles.has(p) && status !== 'deleted') {
      const picks = this.importPicks(p, this.specsReaching(p));
      picks.set(p, `Spec changed: ${p}`);
      return make(3, 'specs', `Spec changed: ${p}`, picks);
    }

    // 4. Anything the Playwright config uses can change every test.
    if (this.configReach.has(p)) return make(4, 'full', `${p} is imported by the Playwright config`);

    // 5. Imported by specs, directly or through other files.
    if (graph.imports.has(p)) {
      const specs = this.specsReaching(p);
      if (specs.length > 0) return make(5, 'specs', `Used by spec files: ${specs.length}`, this.importPicks(p, specs));
    }

    // 6. The old importers of a deleted support file are gone from the graph, so they cannot be found.
    if (status === 'deleted' && supportOrData && !(change.renamedTo !== null && renamedToHasImporters)) {
      return make(6, 'full', `Deleted or renamed support file, importers cannot be checked: ${p}`);
    }

    // 7. A spec file Playwright does not list. The old path of a rename is not a deletion.
    if (fileClass === 'spec') {
      if (change.renamedTo !== null) return make(7, 'none', renamedSpecReason(p, change.renamedTo));
      return make(7, 'none', status === 'deleted' ? deletedSpecReason(p) : `Not in the Playwright inventory: ${p}`);
    }

    // 8. A support script no spec imports. Non-script files may be read at run time, so they go on.
    if (supportOrData && SCRIPT_EXTENSION.test(p) && !graph.imports.has(p)) return make(8, 'none', `No spec imports ${p}`);

    // 9. Areas: the specs that have a test with one of the matching areas' tags.
    const areas = config.areas.filter((area) => matchesGlob(area.glob, p));
    const firstArea = areas[0];
    if (firstArea !== undefined) {
      const picks = new Map<string, string>();
      for (const spec of this.input.inventory.specs) {
        const tags = this.specTags.get(spec.file)!;
        for (const area of areas) {
          const tag = area.tags.find((t) => tags.has(t));
          if (tag !== undefined) {
            picks.set(spec.file, `${p} matches area "${area.glob}" (tag ${tag})`);
            break;
          }
        }
      }
      if (picks.size === 0) {
        const tag = firstArea.tags[0];
        const area = tag === undefined ? null : { glob: firstArea.glob, tag };
        return make(9, 'full', `${p} matches area "${firstArea.glob}" but no test has tag ${tag}`, new Map(), area);
      }
      return make(9, 'specs', `Matches area "${firstArea.glob}"`, picks);
    }

    // 10. Documentation.
    if (fileClass === 'docs') return make(10, 'none', `Documentation only: ${p}`);

    // 11. Unmapped: run everything rather than miss a test.
    return make(11, 'full', `No rule maps ${p} (${fileClass}) to a test`);
  }
}

function selectedSpec(spec: InventorySpec, reasons: string[]): SelectedSpec {
  return {
    file: spec.file,
    testCount: spec.tests.length,
    tags: sortedUnique(spec.tests.flatMap((t) => t.tags)),
    reasons,
  };
}

/** Maps the changed files to the specs they can affect, with a reason for every decision. */
export function mapImpact(input: MapInput): Selection {
  const mapper = new Mapper(input);
  const outcomes: Outcome[] = [];
  const entries: SuggestEntry[] = [];
  const keep = (outcome: Outcome, ranges: LineRange[]): void => {
    outcomes.push(outcome);
    const { decision, rule, area } = outcome;
    entries.push({ decision, rule, area, importers: rule === 5 ? importersOf(input.graph, decision.path) : [], ranges });
  };
  for (const file of input.files) {
    const current = mapper.decide({ path: file.path, status: file.status, fileClass: file.fileClass, renamedTo: null }, false);
    keep(current, file.ranges);
    if (file.status === 'renamed' && file.oldPath !== null) {
      const old: Change = { path: file.oldPath, status: 'deleted', fileClass: classifyPath(file.oldPath), renamedTo: file.path };
      keep(mapper.decide(old, current.rule === 5), []);
    }
  }

  const reasonsBySpec = new Map<string, string[]>();
  for (const { picks } of outcomes) {
    for (const [spec, reason] of picks) reasonsBySpec.set(spec, [...(reasonsBySpec.get(spec) ?? []), reason]);
  }
  const fullReasons = outcomes.filter((o) => o.decision.outcome === 'full').map((o) => o.decision.reason);
  const mode: SelectionMode = fullReasons.length > 0 ? 'full' : reasonsBySpec.size > 0 ? 'subset' : 'none';

  const specs = [...input.inventory.specs].sort((a, b) => compareText(a.file, b.file));
  let selected: SelectedSpec[] = [];
  if (mode === 'full') {
    selected = specs.map((spec) => selectedSpec(spec, [...sortedUnique(reasonsBySpec.get(spec.file) ?? []), FULL_SUITE_RUN]));
  } else if (mode === 'subset') {
    selected = specs
      .filter((spec) => reasonsBySpec.has(spec.file))
      .map((spec) => selectedSpec(spec, sortedUnique(reasonsBySpec.get(spec.file)!)));
  }

  const decisions = outcomes
    .map((o) => o.decision)
    .sort((a, b) => compareText(a.path, b.path) || compareText(a.status, b.status) || compareLists(a.specs, b.specs));

  return {
    schemaVersion: 1,
    source: input.source,
    mode,
    playwrightDir: input.inventory.playwrightDir,
    totalSpecs: input.inventory.specs.length,
    totalTests: input.inventory.specs.reduce((sum, spec) => sum + spec.tests.length, 0),
    selected,
    fullSuiteReasons: mode === 'full' ? sortedUnique(fullReasons) : [],
    decisions,
    warnings: sortedUnique(input.graph.warnings),
    suggestions: suggestTests({ entries, texts: input.texts }),
  };
}
