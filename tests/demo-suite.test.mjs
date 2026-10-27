import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static checks on the demo suite shape that later PRs depend on.
 * Reads files only: no browser, no network.
 */

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const demoRoot = path.join(repoRoot, 'demo', 'saucedemo');
const testsRoot = path.join(demoRoot, 'tests');
const FEATURES = ['login', 'inventory', 'cart', 'checkout'];

// Skipped by name at any depth: VCS data, installs and generated output.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'test-results', 'playwright-report', 'blob-report']);
const SKIP_FILES = new Set(['package-lock.json']);

// Built from code points so this file never holds the characters it bans.
const DASHES = new RegExp(`[${String.fromCodePoint(0x2014)}${String.fromCodePoint(0x2013)}]`);

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...listFiles(full));
    } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function findLines(files, needle) {
  const hits = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (needle.test(line)) hits.push(`${path.relative(repoRoot, file)}:${i + 1}`);
    });
  }
  return hits;
}

const specPath = (feature) => path.join(testsRoot, feature, `${feature}.spec.ts`);

test('demo/saucedemo/tests has exactly the four feature folders, each with one spec', () => {
  const entries = fs.readdirSync(testsRoot, { withFileTypes: true });
  assert.ok(entries.every((e) => e.isDirectory()), 'only folders belong in demo/saucedemo/tests');
  assert.deepEqual(entries.map((e) => e.name).sort(), [...FEATURES].sort());
  for (const feature of FEATURES) {
    assert.deepEqual(fs.readdirSync(path.join(testsRoot, feature)), [`${feature}.spec.ts`]);
  }
});

for (const feature of FEATURES) {
  test(`${feature} spec carries its '@${feature}' tag`, () => {
    assert.ok(fs.readFileSync(specPath(feature), 'utf8').includes(`'@${feature}'`));
  });

  test(`${feature} spec imports at least one Page Object from ../../pages/`, () => {
    assert.match(fs.readFileSync(specPath(feature), 'utf8'), /from '\.\.\/\.\.\/pages\//);
  });
}

test('no file under demo/ uses waitForTimeout', () => {
  const hits = findLines(listFiles(path.join(repoRoot, 'demo')), /waitForTimeout/);
  assert.deepEqual(hits, []);
});

test('no file in the repo contains an em dash or en dash', () => {
  const hits = findLines(listFiles(repoRoot), DASHES);
  assert.deepEqual(hits, []);
});
