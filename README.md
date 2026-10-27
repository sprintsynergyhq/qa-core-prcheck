# Qa-core-prcheck

A CI agent for GitHub Actions that reads a pull request diff, picks the Playwright tests the change can affect, runs only those, suggests missing tests and posts one pass or fail summary before merge.

## Status

PR 2 of 10: diff reader. The CLI lists the files a change touches and gives each one a file class. The agent does not pick or run tests yet.

## Requirements

- Node 22.6 or later
- git, needed for the `diff` command
- Chromium for Playwright, only needed to run the demo suite

## Quick Start

```bash
npm ci                            # install pinned dependencies
npx playwright install chromium   # browser for the demo suite
npm run demo:list                 # list the demo tests and their tags
npm run demo:test                 # run the demo suite against SauceDemo
npm test                          # build, then run the unit tests
```

## Demo Suite

[SauceDemo](https://www.saucedemo.com) is a public practice site and not our code. The suite in `demo/saucedemo/` gives later PRs a small, real Playwright project to pick tests from.

| Feature Folder | Tag | Covers |
| --- | --- | --- |
| `tests/login/` | `@login` | Standard login and the locked out user error |
| `tests/inventory/` | `@inventory` | Sorting products by price and by name |
| `tests/cart/` | `@cart` | Adding and removing a product |
| `tests/checkout/` | `@checkout` | Completing an order and the required first name check |

Layout rules:

- One Page Object per feature in `pages/<feature>-page.ts`, with a PascalCase class.
- One spec per feature in `tests/<feature>/<feature>.spec.ts`, wrapped in one `test.describe` with its feature tag.
- The cart and checkout specs both import `CartPage`, so a change to it affects both.
- Retries stay at 0 so a flaky test is never hidden.
- The only credentials are the public demo ones printed on the SauceDemo login page.

Run one feature by tag:

```bash
npx playwright test -c demo/saucedemo/playwright.config.ts --grep @cart
```

## Diff Command

Lists the files changed between two git refs, or in a saved diff file. It does not pick or run tests.

```bash
npm run build
node dist/cli.js diff --base origin/main                  # from the merge base of origin/main and HEAD, to HEAD
node dist/cli.js diff --base origin/main --head feature   # the same, with a chosen head ref
node dist/cli.js diff --diff-file changes.diff --json     # a saved git diff, printed as JSON
```

| Option | Meaning |
| --- | --- |
| `--base <ref>` | Compare against the merge base of this ref and the head |
| `--head <ref>` | The head ref (default: `HEAD`) |
| `--diff-file <path>` | Read a saved unified git diff instead of running git |
| `--json` | Print JSON instead of text |

Exactly one of `--base` and `--diff-file` is required, and `--head` only works with `--base`. Values follow their option as a separate argument.

With `--base`, the diff starts at the merge base of the two refs, so commits that landed on the base branch after the fork point are not listed. The list is sorted by path, and every path is repo-relative with forward slashes.

Text output for `tests/fixtures/diffs/mixed.diff`:

```text
Changed files: 10
modified  .github/workflows/ci.yml  +1 -0  ci-workflow
modified  .nvmrc  +1 -1  other
modified  README.md  +1 -1  docs
modified  demo/saucedemo/fixtures/users.ts  +1 -0  test-data
modified  demo/saucedemo/pages/cart-page.ts  +1 -1  test-support
modified  demo/saucedemo/playwright.config.ts  +1 -1  playwright-config
modified  demo/saucedemo/tests/cart/cart.spec.ts  +1 -1  spec
modified  package-lock.json  +1 -1  lockfile
modified  package.json  +1 -1  package-manifest
modified  src/cli.ts  +1 -1  app-source
```

With `--base`, a `Merge base: <sha>` line comes first. A renamed or copied file shows as `<oldPath> -> <path>`, and a binary file shows `binary` instead of the line counts.

### Exit Codes

| Code | Meaning |
| --- | --- |
| 0 | Ok, whether or not any files changed |
| 2 | Usage or tool error: the message goes to stderr and stdout stays empty |
| 1 | Reserved for failing tests in later releases |

### JSON Shape

`--json` prints one object, with keys always in this order:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Always `1` |
| `source` | `{ type: "git", base, head, baseSha, headSha, mergeBaseSha }` or `{ type: "file", path }`, with refs and path exactly as given |
| `files[].path` | Repo-relative path in the new tree; for a deleted file, the path it had |
| `files[].oldPath` | The old path for renamed and copied files, otherwise `null` |
| `files[].status` | `added`, `modified`, `deleted`, `renamed` or `copied` |
| `files[].similarity` | Percent from git's similarity index for renamed and copied files, otherwise `null` |
| `files[].binary` | `true` for binary files, which have no line counts or ranges |
| `files[].additions`, `files[].deletions` | Added and removed line counts |
| `files[].ranges` | Added lines in the new file as inclusive, 1-based `{ start, end }` ranges |
| `files[].fileClass` | One of the file classes below |

Real output of `node dist/cli.js diff --diff-file tests/fixtures/diffs/rename-with-edits.diff --json`:

```json
{
  "schemaVersion": 1,
  "source": {
    "type": "file",
    "path": "tests/fixtures/diffs/rename-with-edits.diff"
  },
  "files": [
    {
      "path": "demo/saucedemo/pages/order-page.ts",
      "oldPath": "demo/saucedemo/pages/checkout-page.ts",
      "status": "renamed",
      "similarity": 87,
      "binary": false,
      "additions": 3,
      "deletions": 1,
      "ranges": [
        {
          "start": 3,
          "end": 3
        },
        {
          "start": 10,
          "end": 10
        },
        {
          "start": 19,
          "end": 19
        }
      ],
      "fileClass": "test-support"
    }
  ]
}
```

### File Classes

Built-in rules on the path, case sensitive. The first match wins. "Folder" means a folder name in the path, not the file name.

| Class | Rule |
| --- | --- |
| `ci-workflow` | Path starts with `.github/workflows/` or `.github/actions/` |
| `lockfile` | File name is `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock` or `bun.lockb` |
| `package-manifest` | File name is `package.json` |
| `playwright-config` | File name like `playwright.config.ts` or `playwright.ct.config.mjs` (`ts`, `js`, `mjs`, `cjs`, `mts`, `cts`) |
| `spec` | File name ends in `.spec.` or `.test.` plus `ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs`, `mts` or `cts` |
| `test-data` | A folder is `fixtures`, `test-data` or `testdata` |
| `docs` | Extension `.md`, `.mdx`, `.markdown`, `.txt` or `.rst`; or the file name starts with `LICENSE`; or the first folder is `docs` |
| `test-support` | A folder is `tests`, `test`, `e2e` or `__tests__`; or a folder is `pages`, `page-objects`, `helpers` or `support` and another folder is `demo` |
| `app-source` | Extension `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.vue`, `.svelte`, `.css`, `.scss` or `.html` |
| `other` | Everything else, for example `.nvmrc`, `tsconfig.json` or images. It means unknown: PR 3 will treat these files as unmapped |

### Shallow Clones

The git source needs the merge base of the two refs. `actions/checkout` fetches only the latest commit by default, so the fork point is often missing in CI. The command then exits 2 with a message that says so. Fix it by setting `fetch-depth: 0` on `actions/checkout`, or by running `git fetch --unshallow`.

### Limits

- Only the `a/` and `b/` path prefixes are read from a saved diff. A diff made with `--no-prefix` or other prefixes is rejected.
- Copy detection is off for the git source, so `copied` only appears when a saved diff contains it.
- Combined diffs (`diff --cc`, from merge commits) are not supported.
- `ranges` lists added lines only. A hunk that only deletes lines adds no range.
- File classes come from built-in rules. The config file arrives in PR 3.

## Roadmap

- PR 1: scaffold and demo suite (done)
- PR 2: diff reader (done)
- PR 3: test inventory and impact mapping
- PR 4: test runner and result parsing
- PR 5: PR summary formatter
- PR 6: GitHub Action and PR comment
- PR 7: missing test suggestions
- PR 8: optional LLM ranking
- PR 9: safety and cost guards
- PR 10: eval fixtures and docs

## License

MIT. See [LICENSE](LICENSE).
