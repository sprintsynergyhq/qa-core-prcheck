import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiffError, readGitDiff } from '../dist/diff/index.js';
import { cleanup, createTempRepo, gitEnv, makeShallowClone, runGit } from './helpers/git-repo.mjs';

/**
 * readGitDiff on temporary repos only. Expected values come from the history each test builds,
 * never from running the code under test. This repo's own history is never read.
 */

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lines = (...ls) => ls.map((l) => `${l}\n`).join('');

function newRepo(t) {
  const repo = createTempRepo();
  t.after(() => cleanup(repo.dir));
  return repo;
}

function newEmptyDir(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'prcheck-'));
  t.after(() => cleanup(dir));
  return dir;
}

async function rejectsWith(promise, check) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DiffError, `expected DiffError, got ${error}`);
    check(error.message);
    return true;
  });
}

/** main: fork commit; feature: edits src/second.ts; then main: edits src/first.ts. Leaves feature checked out. */
function buildForkedRepo(t) {
  const repo = newRepo(t);
  repo.write('src/first.ts', lines("export const first = 'backpack';"));
  repo.write('src/second.ts', lines("export const second = 'bike light';"));
  const fork = repo.commitAll('fork point');
  repo.git('checkout', '-q', '-b', 'feature');
  repo.write('src/second.ts', lines("export const second = 'fleece jacket';"));
  const featureTip = repo.commitAll('feature edits second');
  repo.git('checkout', '-q', 'main');
  repo.write('src/first.ts', lines("export const first = 'onesie';"));
  const mainTip = repo.commitAll('main edits first');
  repo.git('checkout', '-q', 'feature');
  return { repo, fork, featureTip, mainTip };
}

test('every status the git source can produce, including a path with spaces', async (t) => {
  const repo = newRepo(t);
  const loginPage = lines(
    "import { type Page } from '@playwright/test';",
    "import { PASSWORD } from '../fixtures/users';",
    '',
    'export class LoginPage {',
    '  constructor(readonly page: Page) {}',
    '',
    '  async loginAs(username: string) {',
    "    await this.page.getByTestId('username').fill(username);",
    "    await this.page.getByTestId('password').fill(PASSWORD);",
    "    await this.page.getByTestId('login-button').click();",
    '  }',
    '}',
  );
  repo.write('src/checkout.ts', lines(
    'export function total(prices: number[]) {',
    '  return prices.reduce((a, b) => a + b, 0);',
    '}',
  ));
  repo.write('docs/old-guide.md', lines('# Old Guide', '', 'Log in as the standard user.'));
  repo.write('demo/saucedemo/pages/cart-page.ts', lines(
    "import { type Page } from '@playwright/test';",
    '',
    'export class CartPage {',
    '  constructor(readonly page: Page) {}',
    '',
    '  async goto() {',
    "    await this.page.goto('/cart.html');",
    '  }',
    '}',
  ));
  repo.write('demo/saucedemo/pages/login-page.ts', loginPage);
  repo.write('docs/team notes.md', lines('# Team Notes', 'Run the cart tests first.'));
  const baseSha = repo.commitAll('base');

  repo.git('checkout', '-q', '-b', 'feature');
  // modified: line 2 replaced
  repo.write('src/checkout.ts', lines(
    'export function total(prices: number[]) {',
    '  return prices.reduce((sum, price) => sum + price, 0);',
    '}',
  ));
  // deleted: 3 lines
  repo.remove('docs/old-guide.md');
  // renamed, no edits
  repo.git('mv', 'demo/saucedemo/pages/cart-page.ts', 'demo/saucedemo/pages/basket-page.ts');
  // renamed with edits: line 4 replaced
  repo.remove('demo/saucedemo/pages/login-page.ts');
  repo.write('demo/saucedemo/pages/sign-in-page.ts', loginPage.replace('export class LoginPage {', 'export class SignInPage {'));
  // modified, path with spaces: line 2 replaced
  repo.write('docs/team notes.md', lines('# Team Notes', 'Run the cart and checkout tests first.'));
  // added: 3 lines
  repo.write('demo/saucedemo/tests/wishlist/wishlist.spec.ts', lines(
    "import { test } from '@playwright/test';",
    '',
    "test.describe('wishlist', { tag: '@wishlist' }, () => {});",
  ));
  const headSha = repo.commitAll('feature');

  const result = await readGitDiff({ base: 'main', head: 'feature', cwd: repo.dir, env: repo.env });

  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.source, { type: 'git', base: 'main', head: 'feature', baseSha, headSha, mergeBaseSha: baseSha });
  assert.equal(result.source.mergeBaseSha, repo.git('rev-parse', 'main'));

  // git scores the edited rename; check it is a detected rename, then compare the rest exactly.
  const edited = result.files.find((f) => f.path === 'demo/saucedemo/pages/sign-in-page.ts');
  assert.ok(edited, 'the edited rename is listed under its new path');
  assert.equal(edited.status, 'renamed');
  assert.equal(typeof edited.similarity, 'number');
  assert.ok(edited.similarity >= 50 && edited.similarity < 100, `similarity ${edited.similarity}`);
  t.diagnostic(`git similarity for the edited rename: ${edited.similarity}%`);
  const files = result.files.map((f) => (f === edited ? { ...f, similarity: 'checked above' } : f));

  assert.deepEqual(files, [
    {
      path: 'demo/saucedemo/pages/basket-page.ts', oldPath: 'demo/saucedemo/pages/cart-page.ts', status: 'renamed',
      similarity: 100, binary: false, additions: 0, deletions: 0, ranges: [], fileClass: 'test-support',
    },
    {
      path: 'demo/saucedemo/pages/sign-in-page.ts', oldPath: 'demo/saucedemo/pages/login-page.ts', status: 'renamed',
      similarity: 'checked above', binary: false, additions: 1, deletions: 1, ranges: [{ start: 4, end: 4 }],
      fileClass: 'test-support',
    },
    {
      path: 'demo/saucedemo/tests/wishlist/wishlist.spec.ts', oldPath: null, status: 'added', similarity: null,
      binary: false, additions: 3, deletions: 0, ranges: [{ start: 1, end: 3 }], fileClass: 'spec',
    },
    {
      path: 'docs/old-guide.md', oldPath: null, status: 'deleted', similarity: null,
      binary: false, additions: 0, deletions: 3, ranges: [], fileClass: 'docs',
    },
    {
      path: 'docs/team notes.md', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 1, deletions: 1, ranges: [{ start: 2, end: 2 }], fileClass: 'docs',
    },
    {
      path: 'src/checkout.ts', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 1, deletions: 1, ranges: [{ start: 2, end: 2 }], fileClass: 'app-source',
    },
  ]);
});

test('the diff starts at the merge base: a later commit on main is not listed', async (t) => {
  const { repo, fork, featureTip, mainTip } = buildForkedRepo(t);
  const result = await readGitDiff({ base: 'main', head: 'feature', cwd: repo.dir, env: repo.env });
  assert.deepEqual(result.source, {
    type: 'git', base: 'main', head: 'feature', baseSha: mainTip, headSha: featureTip, mergeBaseSha: fork,
  });
  assert.deepEqual(result.files, [
    {
      path: 'src/second.ts', oldPath: null, status: 'modified', similarity: null,
      binary: false, additions: 1, deletions: 1, ranges: [{ start: 1, end: 1 }], fileClass: 'app-source',
    },
  ]);
});

test('head defaults to HEAD', async (t) => {
  const { repo, featureTip } = buildForkedRepo(t);
  const explicit = await readGitDiff({ base: 'main', head: 'feature', cwd: repo.dir, env: repo.env });
  const implicit = await readGitDiff({ base: 'main', cwd: repo.dir, env: repo.env });
  assert.equal(implicit.source.head, 'HEAD');
  assert.equal(implicit.source.headSha, featureTip);
  assert.deepEqual(implicit.files, explicit.files);
});

test('the same ref on both sides gives an empty files list', async (t) => {
  const { repo, mainTip } = buildForkedRepo(t);
  const result = await readGitDiff({ base: 'main', head: 'main', cwd: repo.dir, env: repo.env });
  assert.equal(result.source.mergeBaseSha, mainTip);
  assert.deepEqual(result.files, []);
});

test('an unknown ref throws DiffError naming the ref and git fetch', async (t) => {
  const { repo } = buildForkedRepo(t);
  await rejectsWith(readGitDiff({ base: 'nope', cwd: repo.dir, env: repo.env }), (message) => {
    assert.equal(message, 'Unknown ref: nope. Fetch it first, for example git fetch origin <branch>');
  });
});

test('a ref that starts with - is rejected before git runs, and no file is created', async (t) => {
  const { repo } = buildForkedRepo(t);
  const before = fs.readdirSync(repo.dir).sort();
  await rejectsWith(readGitDiff({ base: '--output=x', head: 'feature', cwd: repo.dir, env: repo.env }), (message) => {
    assert.equal(message, 'Invalid ref: --output=x');
  });
  await rejectsWith(readGitDiff({ base: 'main', head: '--output=y', cwd: repo.dir, env: repo.env }), (message) => {
    assert.equal(message, 'Invalid ref: --output=y');
  });
  await rejectsWith(readGitDiff({ base: '', cwd: repo.dir, env: repo.env }), (message) => {
    assert.equal(message, 'Invalid ref: ');
  });
  assert.deepEqual(fs.readdirSync(repo.dir).sort(), before);
});

test('a folder that is not a git repo throws Not a git repository', async (t) => {
  const dir = newEmptyDir(t);
  // Stop git from looking above the temp folder, so the result does not depend on what is there.
  const env = { ...gitEnv(), GIT_CEILING_DIRECTORIES: path.dirname(dir) };
  await rejectsWith(readGitDiff({ base: 'main', cwd: dir, env }), (message) => {
    assert.ok(message.startsWith('Not a git repository'), message);
    assert.equal(message, `Not a git repository: ${dir}`);
  });
  const missing = path.join(dir, 'missing');
  await rejectsWith(readGitDiff({ base: 'main', cwd: missing, env }), (message) => {
    assert.equal(message, `Not a git repository: ${missing}`);
  });
});

test('two histories with no common commit throw DiffError saying they share no history', async (t) => {
  const repo = newRepo(t);
  repo.write('README.md', lines('# SauceDemo Checks'));
  repo.commitAll('main root');
  repo.git('checkout', '-q', '--orphan', 'other');
  repo.write('docs/other.md', lines('# Other History'));
  repo.commitAll('other root');
  await rejectsWith(readGitDiff({ base: 'main', head: 'other', cwd: repo.dir, env: repo.env }), (message) => {
    assert.ok(message.includes('share no history'), message);
    assert.equal(message, 'No merge base found between main and other: the two refs share no history.');
  });
});

test('a shallow clone without the fork point throws DiffError that points to fetch-depth: 0', async (t) => {
  const origin = newRepo(t);
  origin.write('docs/a.md', lines('# A'));
  origin.commitAll('A');
  origin.git('checkout', '-q', '-b', 'feature');
  origin.write('docs/b.md', lines('# B'));
  origin.commitAll('B');
  origin.git('checkout', '-q', 'main');
  origin.write('docs/c.md', lines('# C'));
  origin.commitAll('C');

  const clone = makeShallowClone(origin.dir);
  t.after(() => cleanup(clone));

  // The setup really is the shallow case: git itself finds no merge base in the clone.
  assert.equal(runGit(clone, 'rev-parse', '--is-shallow-repository'), 'true');
  assert.throws(() => runGit(clone, 'merge-base', 'origin/main', 'origin/feature'));

  await rejectsWith(readGitDiff({ base: 'origin/main', head: 'origin/feature', cwd: clone, env: gitEnv() }), (message) => {
    assert.ok(message.includes('shallow'), message);
    assert.ok(message.includes('fetch-depth: 0'), message);
  });
});

test('no file under src/ runs a command through a shell', () => {
  const tsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
  const files = tsFiles(path.join(repoRoot, 'src'));
  assert.ok(files.includes(path.join(repoRoot, 'src', 'diff', 'git.ts')), 'src/diff/git.ts is scanned');
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const banned of ['execSync', 'spawn', 'spawnSync', 'exec(', 'shell:']) {
      if (text.includes(banned)) hits.push(`${path.relative(repoRoot, file)}: ${banned}`);
    }
  }
  assert.deepEqual(hits, []);
  assert.ok(fs.readFileSync(path.join(repoRoot, 'src', 'diff', 'git.ts'), 'utf8').includes('execFile'));
});
