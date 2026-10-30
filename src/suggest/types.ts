import type { LineRange } from '../diff/index.js';
import type { FileDecision } from '../impact/types.js';

/** Sorted in this order within one file. */
export type SuggestionKind = 'unmapped-file' | 'unimported-support' | 'untagged-area' | 'unused-member';

export interface Suggestion {
  file: string;              // repo-relative POSIX path of the changed file
  kind: SuggestionKind;
  reason: string;            // why a test seems to be missing
  idea: string;              // the test to add, in plain words
}

/** One decided path, with the facts behind its decision that only the mapper knows. */
export interface SuggestEntry {
  decision: FileDecision;
  rule: number;                                // the rule in src/impact/map.ts that decided it, 1 to 11
  area: { glob: string; tag: string } | null;  // rule 9 only: the first matching area and its first tag
  importers: string[];                         // rule 5 only: every file that reaches the path through imports, sorted
  ranges: LineRange[];                         // added lines in the new file; empty for the old path of a rename
}

export interface SuggestInput {
  entries: SuggestEntry[];
  texts: ReadonlyMap<string, string>;          // repo-relative path to file text, read from --root; unreadable files are absent
}

export type MemberKind = 'method' | 'property' | 'function';

export interface ChangedMember {
  name: string;
  line: number;              // 1-based line of the declaration
  kind: MemberKind;
}
