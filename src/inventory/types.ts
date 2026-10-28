export interface InventoryTest {
  title: string;       // describe titles and test title joined with " > " (no file, no project)
  line: number;
  tags: string[];      // as written in the source (Playwright JSON drops the @; we restore it), sorted
  projects: string[];  // project names, sorted
}

export interface InventorySpec {
  file: string;        // repo-relative POSIX path
  tests: InventoryTest[];   // sorted by line, then title
}

export interface Inventory {
  schemaVersion: 1;
  playwrightDir: string;    // repo-relative POSIX path of the folder with the Playwright config
  specs: InventorySpec[];   // sorted by file
}

/** An expected failure. The message is plain and meant for the user. */
export class InventoryError extends Error {}
