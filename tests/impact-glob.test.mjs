import test from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, matchesGlob } from '../dist/impact/index.js';

// [glob, path, expected], written by hand from the glob syntax in src/impact/glob.ts.
const CASES = [
  // A glob with no / is matched against the whole path only.
  ['*.md', 'README.md', true],
  ['*.md', 'docs/a.md', false],
  ['**/*.md', 'README.md', true],
  ['**/*.md', 'docs/a.md', true],
  ['**/*.md', 'docs/guide/setup.md', true],
  // A trailing ** needs something after the slash.
  ['docs/**', 'docs/a.md', true],
  ['docs/**', 'docs/x/y.md', true],
  ['docs/**', 'docs', false],
  ['docs/**', 'docsx/a.md', false],
  // **/ in the middle matches zero or more whole folders.
  ['demo/**/cart-page.ts', 'demo/cart-page.ts', true],
  ['demo/**/cart-page.ts', 'demo/saucedemo/pages/cart-page.ts', true],
  ['demo/**/cart-page.ts', 'demo/saucedemo/pages/old-cart-page.ts', false],
  ['a/**/b', 'a/b', true],
  ['a/**/b', 'a/x/y/b', true],
  // ** not next to a slash matches any run, including /.
  ['demo/**.ts', 'demo/saucedemo/pages/cart-page.ts', true],
  // * and ? stop at a slash.
  ['demo/*/cart-page.ts', 'demo/saucedemo/cart-page.ts', true],
  ['demo/*/cart-page.ts', 'demo/saucedemo/pages/cart-page.ts', false],
  ['a?b', 'aXb', true],
  ['a?b', 'a/b', false],
  ['a?b', 'ab', false],
  // Regex characters are literal.
  ['a.b', 'a.b', true],
  ['a.b', 'aXb', false],
  ['docs/(draft)+[1]{2}^$|x.md', 'docs/(draft)+[1]{2}^$|x.md', true],
  ['docs/(draft)+.md', 'docs/(draft).md', false],
  ['docs/a\\b.md', 'docs/a\\b.md', true],
  ['docs/a\\b.md', 'docs/ab.md', false],
  // Case sensitive.
  ['README.md', 'readme.md', false],
  ['*.MD', 'README.md', false],
  // The match covers the whole path.
  ['cart-page.ts', 'demo/saucedemo/pages/cart-page.ts', false],
  ['demo/saucedemo', 'demo/saucedemo/pages/cart-page.ts', false],
  ['pages/*.ts', 'demo/saucedemo/pages/cart-page.ts', false],
  ['**', 'demo/saucedemo/pages/cart-page.ts', true],
];

for (const [glob, path, expected] of CASES) {
  test(`${glob} ${expected ? 'matches' : 'does not match'} ${path}`, () => {
    assert.equal(matchesGlob(glob, path), expected);
  });
}

test('globToRegExp gives an anchored RegExp', () => {
  const regexp = globToRegExp('docs/*.md');
  assert.ok(regexp instanceof RegExp);
  assert.ok(regexp.source.startsWith('^'));
  assert.ok(regexp.source.endsWith('$'));
  assert.equal(regexp.test('docs/a.md'), true);
  assert.equal(regexp.test('x/docs/a.md'), false);
});
