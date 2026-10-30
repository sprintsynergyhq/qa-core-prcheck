import type { ChangeStatus, DiffSource, FileClass } from '../diff/index.js';
import type { Suggestion } from '../suggest/types.js';

export type SelectionMode = 'none' | 'subset' | 'full';

export type FileOutcome = 'ignored' | 'none' | 'specs' | 'full';

export interface ImpactConfig {
  playwrightDir: string;                              // default "demo/saucedemo"
  areas: { glob: string; tags: string[] }[];          // sorted by glob; tags sorted, no duplicates
  fullSuiteOn: string[];                              // sorted, no duplicates
  ignore: string[];                                   // sorted, no duplicates
}

export interface FileDecision {
  path: string;
  fileClass: FileClass;
  status: ChangeStatus;
  outcome: FileOutcome;
  reason: string;
  specs: string[];            // repo-relative spec files this file selects, sorted; empty unless outcome is "specs"
}

export interface SelectedSpec {
  file: string;
  testCount: number;
  tags: string[];             // union of the tags of its tests, sorted
  reasons: string[];          // never empty, sorted, no duplicates; in mode "full" the full suite reason comes last
}

export interface Selection {
  schemaVersion: 1;
  source: DiffSource;
  mode: SelectionMode;
  playwrightDir: string;
  totalSpecs: number;
  totalTests: number;
  selected: SelectedSpec[];        // sorted by file; in mode "full" this is every spec
  fullSuiteReasons: string[];      // sorted, no duplicates; empty unless mode is "full"
  decisions: FileDecision[];       // sorted by path, then status
  warnings: string[];              // sorted, no duplicates
  suggestions: Suggestion[];       // sorted by file, kind, reason; advisory, they never change the keys above
}

/** An expected failure. The message is plain and meant for the user. */
export class ImpactError extends Error {}
