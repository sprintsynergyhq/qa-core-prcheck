import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPath } from '../dist/diff/index.js';

// Expected classes are written by hand from the rules in src/diff/classify.ts (first match wins).
const CASES = [
  ['.github/workflows/ci.yml', 'ci-workflow'],
  ['package-lock.json', 'lockfile'],
  ['yarn.lock', 'lockfile'],
  ['package.json', 'package-manifest'],
  ['demo/saucedemo/playwright.config.ts', 'playwright-config'],
  ['playwright.config.mjs', 'playwright-config'],
  ['demo/saucedemo/tests/cart/cart.spec.ts', 'spec'],
  ['tests/cli.test.mjs', 'spec'],
  ['demo/saucedemo/fixtures/users.ts', 'test-data'],
  ['tests/fixtures/diffs/add.diff', 'test-data'],
  ['README.md', 'docs'],
  ['LICENSE', 'docs'],
  ['docs/guide/setup.png', 'docs'], // first folder is docs
  ['notes.txt', 'docs'],
  ['demo/saucedemo/pages/cart-page.ts', 'test-support'],
  ['tests/helpers/git-repo.mjs', 'test-support'],
  ['e2e/support/login.ts', 'test-support'],
  ['src/cli.ts', 'app-source'],
  ['src/pages/home.tsx', 'app-source'], // a pages folder without a demo folder is not test support
  ['web/styles/site.css', 'app-source'],
  ['.nvmrc', 'other'],
  ['tsconfig.json', 'other'],
  ['.gitignore', 'other'],
  ['assets/logo.png', 'other'],
];

for (const [path, expected] of CASES) {
  test(`classifyPath('${path}') is ${expected}`, () => {
    assert.equal(classifyPath(path), expected);
  });
}
