import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ImpactError, loadConfig } from '../dist/impact/index.js';
import { cleanup } from './helpers/git-repo.mjs';

// Each case writes qa-core-prcheck.config.json into its own temp folder. Expected values are written by hand.

function newDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  return dir;
}

function withConfig(t, content) {
  const dir = newDir(t);
  fs.writeFileSync(path.join(dir, 'qa-core-prcheck.config.json'), typeof content === 'string' ? content : JSON.stringify(content));
  return dir;
}

function throwsImpactError(dir, ...needles) {
  assert.throws(() => loadConfig(dir), (error) => {
    assert.ok(error instanceof ImpactError, `expected ImpactError, got ${error}`);
    for (const needle of needles) assert.ok(error.message.includes(needle), `"${error.message}" should include "${needle}"`);
    return true;
  });
}

test('no config file gives the defaults', (t) => {
  assert.deepEqual(loadConfig(newDir(t)), {
    playwrightDir: 'demo/saucedemo', areas: [], fullSuiteOn: [], ignore: [],
  });
});

test('a full valid file is read', (t) => {
  const dir = withConfig(t, {
    playwrightDir: 'demo/saucedemo',
    areas: { 'demo/saucedemo/pages/cart-page.ts': ['@cart'] },
    fullSuiteOn: ['demo/saucedemo/fixtures/**'],
    ignore: ['docs/**', '**/*.md'],
  });
  assert.deepEqual(loadConfig(dir), {
    playwrightDir: 'demo/saucedemo',
    areas: [{ glob: 'demo/saucedemo/pages/cart-page.ts', tags: ['@cart'] }],
    fullSuiteOn: ['demo/saucedemo/fixtures/**'],
    ignore: ['**/*.md', 'docs/**'],
  });
});

test('areas, their tags and both lists are sorted in code unit order, without duplicates', (t) => {
  const dir = withConfig(t, {
    areas: { 'src/cart/**': ['@cart', '@Cart', '@cart'], 'src/**/*.ts': ['@login'], 'docs/**': ['@docs'] },
    fullSuiteOn: ['b/**', 'a/**', 'B/**', 'a/**'],
    ignore: ['z.md', '*.md', 'a.md'],
  });
  assert.deepEqual(loadConfig(dir), {
    playwrightDir: 'demo/saucedemo',
    areas: [
      { glob: 'docs/**', tags: ['@docs'] },
      { glob: 'src/**/*.ts', tags: ['@login'] },
      { glob: 'src/cart/**', tags: ['@Cart', '@cart'] },
    ],
    fullSuiteOn: ['B/**', 'a/**', 'b/**'],
    ignore: ['*.md', 'a.md', 'z.md'],
  });
});

for (const [raw, expected] of [['./demo/x/', 'demo/x'], ['demo\\x', 'demo/x'], ['demo//x/', 'demo/x'], ['.', '.'], ['./', '.']]) {
  test(`playwrightDir ${raw} becomes ${expected}`, (t) => {
    assert.equal(loadConfig(withConfig(t, { playwrightDir: raw })).playwrightDir, expected);
  });
}

test('invalid JSON names the file', (t) => {
  throwsImpactError(withConfig(t, '{ "playwrightDir": '), 'qa-core-prcheck.config.json is not valid JSON');
});

for (const [label, content] of [['an array', '[]'], ['a string', '"demo"'], ['null', 'null']]) {
  test(`a top level that is ${label} is rejected`, (t) => {
    throwsImpactError(withConfig(t, content), 'qa-core-prcheck.config.json', 'top level must be a JSON object');
  });
}

test('an unknown key is named, with the allowed keys', (t) => {
  throwsImpactError(withConfig(t, { playwrightDir: 'demo/saucedemo', testDir: 'tests' }),
    'unknown key "testDir"', 'Allowed keys: playwrightDir, areas, fullSuiteOn, ignore');
});

const BAD_VALUES = [
  ['an empty playwrightDir', { playwrightDir: '' }, '"playwrightDir" must be a non-empty string'],
  ['a playwrightDir that is not a string', { playwrightDir: 3 }, '"playwrightDir" must be a non-empty string'],
  ['an absolute playwrightDir', { playwrightDir: '/repo/demo' }, '"playwrightDir" must be relative to the root, not absolute'],
  ['a Windows absolute playwrightDir', { playwrightDir: 'C:\\repo\\demo' }, '"playwrightDir" must be relative to the root, not absolute'],
  ['a playwrightDir with ..', { playwrightDir: 'demo/../other' }, '"playwrightDir" must not contain ".."'],
  ['a playwrightDir that is ..', { playwrightDir: '..' }, '"playwrightDir" must not contain ".."'],
  ['areas as an array', { areas: [] }, '"areas" must be an object'],
  ['areas as a string', { areas: '@cart' }, '"areas" must be an object'],
  ['an area with an empty glob', { areas: { '': ['@cart'] } }, '"areas" has an empty glob'],
  ['an area with no tags', { areas: { 'src/**': [] } }, '"areas" value for "src/**"'],
  ['an area whose value is a string', { areas: { 'src/**': '@cart' } }, '"areas" value for "src/**"'],
  ['a tag without @', { areas: { 'src/**': ['@cart', 'cart'] } }, '"areas" value for "src/**" must be a non-empty array of tags that start with @'],
  ['fullSuiteOn as a string', { fullSuiteOn: 'docs/**' }, '"fullSuiteOn" must be an array of non-empty strings'],
  ['fullSuiteOn with an empty string', { fullSuiteOn: ['docs/**', ''] }, '"fullSuiteOn" must be an array of non-empty strings'],
  ['ignore with a number', { ignore: ['docs/**', 1] }, '"ignore" must be an array of non-empty strings'],
  ['ignore as an object', { ignore: { 'docs/**': true } }, '"ignore" must be an array of non-empty strings'],
];

for (const [label, content, message] of BAD_VALUES) {
  test(`${label} is rejected with a message that names the key`, (t) => {
    throwsImpactError(withConfig(t, content), 'qa-core-prcheck.config.json', message);
  });
}
