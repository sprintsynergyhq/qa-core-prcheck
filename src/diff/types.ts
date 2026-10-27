export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export type FileClass =
  | 'spec' | 'test-support' | 'test-data' | 'playwright-config' | 'package-manifest'
  | 'lockfile' | 'ci-workflow' | 'docs' | 'app-source' | 'other';

/** Inclusive, 1-based line numbers in the new version of the file. */
export interface LineRange { start: number; end: number }

export interface ChangedFile {
  path: string;              // repo-relative POSIX path in the new tree (for a deleted file, the path it had)
  oldPath: string | null;    // set only for renamed and copied files
  status: ChangeStatus;
  similarity: number | null; // percent from "similarity index", only for renamed and copied files
  binary: boolean;
  additions: number;         // 0 when binary
  deletions: number;         // 0 when binary
  ranges: LineRange[];       // added lines in the new file; empty when binary, deleted or no hunks
  fileClass: FileClass;
}

export type DiffSource =
  | { type: 'git'; base: string; head: string; baseSha: string; headSha: string; mergeBaseSha: string }
  | { type: 'file'; path: string };

export interface DiffResult {
  schemaVersion: 1;
  source: DiffSource;
  files: ChangedFile[];
}

/** An expected failure. The message is plain and meant for the user. */
export class DiffError extends Error {}
