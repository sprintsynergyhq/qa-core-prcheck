import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiffError, parseUnifiedDiff } from '../dist/diff/index.js';

/**
 * Every expected value below was written by hand from reading the fixture text
 * (hunk headers, + and - lines, new file line numbers), not from parser output.
 */

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = (name) => fs.readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'diffs', name), 'utf8');

test('add.diff: one added file', () => {
  assert.deepEqual(parseUnifiedDiff(fixture('add.diff')), [
    {
      path: 'demo/saucedemo/pages/wishlist-page.ts', oldPath: null, status: 'added', similarity: null,
      binary: false, additions: 11, deletions: 0, ranges: [{ start: 1, end: 11 }], fileClass: 'test-support',
    },
  ]);
});

test('modify.diff: one modified file, one hunk with context lines', () => {
  // @@ -4,11 +4,12 @@: the added readonly line is new line 7, the replaced checkoutButton line is new line 12.
  assert.deepEqual(parseUnifiedDiff(fixture('modify.diff')), [
    {
      path: 'demo/saucedemo/pages/cart-page.ts', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 2, deletions: 1, ranges: [{ start: 7, end: 7 }, { start: 12, end: 12 }],
      fileClass: 'test-support',
    },
  ]);
});

test('delete.diff: one deleted file keeps the path it had and has no ranges', () => {
  assert.deepEqual(parseUnifiedDiff(fixture('delete.diff')), [
    {
      path: 'docs/old-notes.md', oldPath: null, status: 'deleted', similarity: null,
      binary: false, additions: 0, deletions: 3, ranges: [], fileClass: 'docs',
    },
  ]);
});

test('rename.diff: a pure rename has no hunks and similarity 100', () => {
  assert.deepEqual(parseUnifiedDiff(fixture('rename.diff')), [
    {
      path: 'demo/saucedemo/pages/basket-page.ts', oldPath: 'demo/saucedemo/pages/cart-page.ts', status: 'renamed',
      similarity: 100, binary: false, additions: 0, deletions: 0, ranges: [], fileClass: 'test-support',
    },
  ]);
});

test('rename-with-edits.diff: a rename with two hunks keeps the similarity from the fixture', () => {
  // Hunk 1 @@ -1,12 +1,13 @@: new lines 3 (class name) and 10 (cancelButton field).
  // Hunk 2 @@ -15,6 +16,7 @@: new line 19 (cancelButton assignment).
  assert.deepEqual(parseUnifiedDiff(fixture('rename-with-edits.diff')), [
    {
      path: 'demo/saucedemo/pages/order-page.ts', oldPath: 'demo/saucedemo/pages/checkout-page.ts', status: 'renamed',
      similarity: 87, binary: false, additions: 3, deletions: 1,
      ranges: [{ start: 3, end: 3 }, { start: 10, end: 10 }, { start: 19, end: 19 }], fileClass: 'test-support',
    },
  ]);
});

test('binary.diff: binary files have no counts and no ranges', () => {
  assert.deepEqual(parseUnifiedDiff(fixture('binary.diff')), [
    {
      path: 'docs/banner.png', oldPath: null, status: 'modified', similarity: null,
      binary: true, additions: 0, deletions: 0, ranges: [], fileClass: 'docs',
    },
    {
      path: 'docs/logo.png', oldPath: null, status: 'added', similarity: null,
      binary: true, additions: 0, deletions: 0, ranges: [], fileClass: 'docs',
    },
  ]);
});

test('spaces-in-path.diff: paths with spaces lose the trailing TAB and stay whole', () => {
  assert.deepEqual(parseUnifiedDiff(fixture('spaces-in-path.diff')), [
    {
      path: 'docs/my folder/team notes.md', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 1, deletions: 1, ranges: [{ start: 4, end: 4 }], fileClass: 'docs',
    },
    {
      path: 'docs/new name.md', oldPath: 'docs/old name.md', status: 'renamed', similarity: 100,
      binary: false, additions: 0, deletions: 0, ranges: [], fileClass: 'docs',
    },
    {
      path: 'docs/release notes.md', oldPath: null, status: 'added', similarity: null,
      binary: false, additions: 3, deletions: 0, ranges: [{ start: 1, end: 3 }], fileClass: 'docs',
    },
  ]);
});

test('multiple-hunks.diff: add only, delete only and change hunks in one file', () => {
  // Hunk 1 @@ -5,6 +5,7 @@ adds new line 8. Hunk 2 @@ -17,10 +18,6 @@ only deletes 4 lines: no range.
  // Hunk 3 @@ -34,7 +31,7 @@ replaces one line: new line 34.
  assert.deepEqual(parseUnifiedDiff(fixture('multiple-hunks.diff')), [
    {
      path: 'demo/saucedemo/pages/inventory-page.ts', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 2, deletions: 5, ranges: [{ start: 8, end: 8 }, { start: 34, end: 34 }],
      fileClass: 'test-support',
    },
  ]);
});

test('no-newline.diff: the \\ No newline marker is not counted as a line', () => {
  // Two markers: one inside the hunk (after the - line), one after the hunk's counts are used up.
  assert.deepEqual(parseUnifiedDiff(fixture('no-newline.diff')), [
    {
      path: 'docs/checkout-notes.txt', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 1, deletions: 1, ranges: [{ start: 4, end: 4 }], fileClass: 'docs',
    },
  ]);
});

test('content-looks-like-headers.diff: --- and +++ content lines inside a hunk are counted, not read as headers', () => {
  assert.deepEqual(parseUnifiedDiff(fixture('content-looks-like-headers.diff')), [
    {
      path: 'docs/cart-notes.md', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 1, deletions: 1, ranges: [{ start: 4, end: 4 }], fileClass: 'docs',
    },
  ]);
});

test('mixed.diff: ten files, one per file class, in plain code unit order', () => {
  const files = parseUnifiedDiff(fixture('mixed.diff'));
  // Uppercase sorts before lowercase, and package-lock.json before package.json.
  assert.deepEqual(files.map((f) => f.path), [
    '.github/workflows/ci.yml',
    '.nvmrc',
    'README.md',
    'demo/saucedemo/fixtures/users.ts',
    'demo/saucedemo/pages/cart-page.ts',
    'demo/saucedemo/playwright.config.ts',
    'demo/saucedemo/tests/cart/cart.spec.ts',
    'package-lock.json',
    'package.json',
    'src/cli.ts',
  ]);
  const modified = (path, additions, deletions, line, fileClass) => ({
    path, oldPath: null, status: 'modified', similarity: null, binary: false,
    additions, deletions, ranges: [{ start: line, end: line }], fileClass,
  });
  assert.deepEqual(files, [
    modified('.github/workflows/ci.yml', 1, 0, 8, 'ci-workflow'),
    modified('.nvmrc', 1, 1, 1, 'other'), // @@ -1 +1 @@: counts default to 1
    modified('README.md', 1, 1, 3, 'docs'),
    modified('demo/saucedemo/fixtures/users.ts', 1, 0, 6, 'test-data'),
    modified('demo/saucedemo/pages/cart-page.ts', 1, 1, 15, 'test-support'),
    modified('demo/saucedemo/playwright.config.ts', 1, 1, 6, 'playwright-config'),
    modified('demo/saucedemo/tests/cart/cart.spec.ts', 1, 1, 5, 'spec'),
    modified('package-lock.json', 1, 1, 3, 'lockfile'),
    modified('package.json', 1, 1, 3, 'package-manifest'),
    modified('src/cli.ts', 1, 1, 1, 'app-source'),
  ]);
});

test('empty.diff and whitespace-only input give an empty list', () => {
  assert.equal(fixture('empty.diff'), '');
  assert.deepEqual(parseUnifiedDiff(fixture('empty.diff')), []);
  assert.deepEqual(parseUnifiedDiff(' \n\t\n'), []);
});

test('the output is sorted whatever the input order, and the same on every run', () => {
  const forward = parseUnifiedDiff(fixture('add.diff') + fixture('delete.diff'));
  const backward = parseUnifiedDiff(fixture('delete.diff') + fixture('add.diff'));
  assert.deepEqual(forward.map((f) => f.path), ['demo/saucedemo/pages/wishlist-page.ts', 'docs/old-notes.md']);
  assert.deepEqual(backward, forward);
  assert.deepEqual(parseUnifiedDiff(fixture('mixed.diff')), parseUnifiedDiff(fixture('mixed.diff')));
});

test('a quoted path with octal escapes is decoded as UTF-8, in --- and +++ lines and in the diff --git line', () => {
  // String.raw keeps the backslashes exactly as git writes them.
  const text = String.raw`diff --git "a/docs/caf\303\251.md" "b/docs/caf\303\251.md"
new file mode 100644
--- /dev/null
+++ "b/docs/caf\303\251.md"
@@ -0,0 +1 @@
+Coffee break notes
diff --git "a/docs/caf\303\251.png" "b/docs/caf\303\251.png"
new file mode 100644
Binary files /dev/null and "b/docs/caf\303\251.png" differ
`;
  const eAcute = String.fromCodePoint(0xe9);
  assert.deepEqual(parseUnifiedDiff(text), [
    {
      path: `docs/caf${eAcute}.md`, oldPath: null, status: 'added', similarity: null,
      binary: false, additions: 1, deletions: 0, ranges: [{ start: 1, end: 1 }], fileClass: 'docs',
    },
    {
      path: `docs/caf${eAcute}.png`, oldPath: null, status: 'added', similarity: null,
      binary: true, additions: 0, deletions: 0, ranges: [], fileClass: 'docs',
    },
  ]);
});

test('copy from and copy to give status copied', () => {
  const text = `diff --git a/demo/saucedemo/pages/cart-page.ts b/demo/saucedemo/pages/basket-page.ts
similarity index 100%
copy from demo/saucedemo/pages/cart-page.ts
copy to demo/saucedemo/pages/basket-page.ts
`;
  assert.deepEqual(parseUnifiedDiff(text), [
    {
      path: 'demo/saucedemo/pages/basket-page.ts', oldPath: 'demo/saucedemo/pages/cart-page.ts', status: 'copied',
      similarity: 100, binary: false, additions: 0, deletions: 0, ranges: [], fileClass: 'test-support',
    },
  ]);
});

test('a mode-only change is modified with no counts; the path with a space comes from the diff --git line', () => {
  const text = `diff --git a/scripts/run demo.sh b/scripts/run demo.sh
old mode 100644
new mode 100755
`;
  assert.deepEqual(parseUnifiedDiff(text), [
    {
      path: 'scripts/run demo.sh', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 0, deletions: 0, ranges: [], fileClass: 'other',
    },
  ]);
});

test('a new empty file is added with 0 additions', () => {
  const text = `diff --git a/docs/empty notes.md b/docs/empty notes.md
new file mode 100644
`;
  assert.deepEqual(parseUnifiedDiff(text), [
    {
      path: 'docs/empty notes.md', oldPath: null, status: 'added', similarity: null,
      binary: false, additions: 0, deletions: 0, ranges: [], fileClass: 'docs',
    },
  ]);
});

test('two touching ranges merge into one: +a, -x, +b gives one range of 2 lines', () => {
  const text = `diff --git a/docs/list.md b/docs/list.md
--- a/docs/list.md
+++ b/docs/list.md
@@ -1 +1,2 @@
+a
-x
+b
`;
  assert.deepEqual(parseUnifiedDiff(text), [
    {
      path: 'docs/list.md', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 2, deletions: 1, ranges: [{ start: 1, end: 2 }], fileClass: 'docs',
    },
  ]);
});

test('a hunk header without counts and with text after the second @@', () => {
  const text = `diff --git a/docs/list.md b/docs/list.md
--- a/docs/list.md
+++ b/docs/list.md
@@ -2 +2 @@ some text
-old second line
+new second line
`;
  assert.deepEqual(parseUnifiedDiff(text), [
    {
      path: 'docs/list.md', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 1, deletions: 1, ranges: [{ start: 2, end: 2 }], fileClass: 'docs',
    },
  ]);
});

test('an empty line inside a hunk counts as a context line', () => {
  const text = `diff --git a/docs/list.md b/docs/list.md
--- a/docs/list.md
+++ b/docs/list.md
@@ -1,3 +1,3 @@
 first

-x
+y
`;
  assert.deepEqual(parseUnifiedDiff(text), [
    {
      path: 'docs/list.md', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 1, deletions: 1, ranges: [{ start: 3, end: 3 }], fileClass: 'docs',
    },
  ]);
});

test('text that is not a diff throws DiffError', () => {
  assert.throws(
    () => parseUnifiedDiff('# SauceDemo Checks\n\nRuns the demo suite.\n'),
    (error) => error instanceof DiffError && error.message === 'Input is not a git unified diff',
  );
});

test('a hunk cut off before its counts are used up throws DiffError that names the file', () => {
  const cut = `diff --git a/docs/list.md b/docs/list.md
--- a/docs/list.md
+++ b/docs/list.md
@@ -1,3 +1,3 @@
 first
-second
`;
  assert.throws(() => parseUnifiedDiff(cut), (error) => error instanceof DiffError && error.message.includes('docs/list.md'));
  // Cut off and followed by the next file: the next diff --git line cannot be hunk content.
  assert.throws(
    () => parseUnifiedDiff(cut + fixture('add.diff')),
    (error) => error instanceof DiffError && error.message.includes('docs/list.md'),
  );
});

test('a combined diff (diff --cc) throws DiffError', () => {
  const text = `diff --cc src/cli.ts
--- a/src/cli.ts
+++ b/src/cli.ts
`;
  assert.throws(() => parseUnifiedDiff(text), (error) => error instanceof DiffError && /diff --cc/.test(error.message));
});

test('a saved diff without the a/ and b/ prefixes throws DiffError', () => {
  const text = `diff --git docs/list.md docs/list.md
--- docs/list.md
+++ docs/list.md
@@ -1 +1 @@
-x
+y
`;
  assert.throws(() => parseUnifiedDiff(text), (error) => error instanceof DiffError && /a\/ and b\/ path prefixes/.test(error.message));
});
