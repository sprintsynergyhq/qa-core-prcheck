# Qa-core-prcheck

A CI agent for GitHub Actions that reads a pull request diff, picks the Playwright tests the change can affect, runs only those, suggests missing tests and posts one pass or fail summary before merge.

## Status

PR 3 of 10: test inventory and impact mapping. The CLI lists the files a change touches, and picks the Playwright specs the change can affect, with a written reason for each pick. The agent does not run tests yet.

## Requirements

- Node 22.6 or later
- git, needed for the `diff` and `select` commands with `--base`
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
| `other` | Everything else, for example `.nvmrc`, `tsconfig.json` or images. It means unknown: the `select` command treats these files as unmapped unless an earlier rule or the config covers them |

### Shallow Clones

The git source needs the merge base of the two refs. `actions/checkout` fetches only the latest commit by default, so the fork point is often missing in CI. The command then exits 2 with a message that says so. Fix it by setting `fetch-depth: 0` on `actions/checkout`, or by running `git fetch --unshallow`.

### Limits

- Only the `a/` and `b/` path prefixes are read from a saved diff. A diff made with `--no-prefix` or other prefixes is rejected.
- Copy detection is off for the git source, so `copied` only appears when a saved diff contains it.
- Combined diffs (`diff --cc`, from merge commits) are not supported.
- `ranges` lists added lines only. A hunk that only deletes lines adds no range.
- File classes come from built-in rules. The `select` config file does not change them.

## Select Command

Picks the Playwright specs a change can affect and gives a written reason for every pick. It does not run any test. The rules are fixed and run locally: no network, no API key.

```bash
npm run build
node dist/cli.js select --base origin/main                  # the change from the merge base of origin/main and HEAD
node dist/cli.js select --base origin/main --head feature   # the same, with a chosen head ref
node dist/cli.js select --diff-file changes.diff --json     # a saved git diff, printed as JSON
```

| Option | Meaning |
| --- | --- |
| `--base <ref>` | Compare against the merge base of this ref and the head |
| `--head <ref>` | The head ref (default: `HEAD`) |
| `--diff-file <path>` | Read a saved unified git diff instead of running git |
| `--root <dir>` | The repository root (default: the current folder) |
| `--json` | Print JSON instead of text |

The option rules are the same as for `diff`: exactly one of `--base` and `--diff-file`, `--head` only with `--base`, and values follow their option as a separate argument. git runs in `--root`. A relative `--diff-file` path is read from the current folder. With `--base`, the merge base and shallow clone notes of the `diff` command apply.

The command reads the diff, then `qa-core-prcheck.config.json`, then finds the Playwright folder and its config file. Only then does it run `playwright test --list --reporter=json`, so a bad ref or a bad config fails before Playwright starts. Listing tests needs no browser. Playwright runs through `execFile` with an argument array, with `CI`, `GITHUB_ACTIONS`, `PW_TEST_REPORTER` and the `PLAYWRIGHT_JSON_OUTPUT_*` variables removed from its environment. Last, the command builds the import graph and applies the rules.

### Select Exit Codes

| Code | Meaning |
| --- | --- |
| 0 | Ok, in every mode, including `full` |
| 2 | Usage or tool error: the message goes to stderr and stdout stays empty |
| 1 | Reserved for failing tests in later releases |

### Modes

| Mode | Meaning |
| --- | --- |
| `none` | No changed file can affect a test, for example a docs-only change. Nothing needs to run |
| `subset` | Only the listed specs can be affected |
| `full` | At least one changed file can affect any test, or no rule maps it. Every spec is listed, and `fullSuiteReasons` says why |

### Rules

Each changed file goes through the rules in this order, and the first rule that matches decides it. The old path of a renamed file is checked too, as a deleted file. A copied file is checked by its new path only, because its source still exists.

| Rule | When | Outcome |
| --- | --- | --- |
| 1. Ignore | The path matches an `ignore` glob. This beats every other rule, including a lockfile | `ignored` |
| 2. Full suite trigger | A Playwright config, `package.json`, lockfile or CI workflow file, or a `fullSuiteOn` glob match | `full` |
| 3. Changed spec | A spec in the Playwright inventory that was not deleted | The spec, plus every spec that imports it |
| 4. Used by the config | The Playwright config imports the file, directly or through other files | `full` |
| 5. Imported by specs | One or more specs import the file, directly or through other files | Those specs |
| 6. Deleted support file | A deleted or renamed away `test-support` or `test-data` file. Skipped for the old path of a rename whose new path rule 5 maps | `full` |
| 7. Spec outside the inventory | A `spec` class file that Playwright does not list, or a deleted spec | `none` |
| 8. Unreached support script | A `test-support` or `test-data` script (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`) that no spec imports | `none` |
| 9. Areas | The path matches one or more `areas` globs | The specs with a test that has one of their tags, or `full` when no test has any |
| 10. Docs | A `docs` class file | `none` |
| 11. Unmapped | Anything else | `full` |

Specs and imports are decided from the real inventory and the import graph first. The file class only matters after that, so a Page Object outside a demo folder (class `app-source`) is still mapped by rule 5 when a spec imports it.

Rule 8 comes before rule 9, so an area cannot pick specs for a support script that no spec imports. Support and data files that are not scripts, such as JSON or images, skip rule 8, because a test may read them at run time.

Each selected spec lists why it was picked, for example `<file> is imported by <spec>` or `<file> is imported by <spec> through <a> -> <b>`. The chain is the shortest import path from the spec, and when several exist, the one that sorts first. In mode `full`, every spec is listed and its last reason is `Part of the full suite run`.

### Config File

`qa-core-prcheck.config.json` at the root is optional, and so is every key in it:

```json
{
  "playwrightDir": "demo/saucedemo",
  "areas": { "demo/saucedemo/pages/cart-page.ts": ["@cart"] },
  "fullSuiteOn": ["demo/saucedemo/fixtures/**"],
  "ignore": ["docs/**", "**/*.md"]
}
```

| Key | Meaning | Default |
| --- | --- | --- |
| `playwrightDir` | The folder with the Playwright config, relative to the root. `.` means the root | `demo/saucedemo` |
| `areas` | Maps a glob to a list of tags. Each tag starts with `@`, as written in the specs | none |
| `fullSuiteOn` | Globs that run the full suite | none |
| `ignore` | Globs that are ignored | none |

These problems exit 2 with a message that names the file and the key:

- the file is not valid JSON, or its top level is not an object
- a key other than the four above
- `playwrightDir` is not a non-empty string, is absolute, or has a `..` folder
- `areas` is not an object, has an empty glob, or maps a glob to anything other than a non-empty list of tags that start with `@`
- `fullSuiteOn` or `ignore` is not a list of non-empty strings

`playwrightDir` is normalized: `./demo/x/` becomes `demo/x`. Areas are sorted by glob, and tags and lists are sorted with duplicates removed. Fuller validation with limits arrives in PR 9.

The Playwright config file is the first of `playwright.config.ts`, `.js`, `.mts`, `.mjs`, `.cts` and `.cjs` found in `playwrightDir`. That is the order Playwright itself uses.

### Glob Syntax

Globs match repo-relative paths with forward slashes. Matching is case sensitive and must cover the whole path.

| Pattern | Matches |
| --- | --- |
| `*` | Any run of characters except `/` |
| `**` | Any run of characters, including `/` |
| `**/` | At the start or after a `/`: zero or more whole folders |
| `?` | One character except `/` |

Every other character is literal. There are no braces, negation or character classes. `*.md` matches `README.md` but not `docs/a.md`, and `**/*.md` matches both. `docs/**` matches `docs/a.md` and `docs/x/y.md` but not `docs`.

### Text Output

Real output of `node dist/cli.js select --diff-file tests/fixtures/diffs/modify.diff`:

```text
Mode: subset
Selected specs: 2 of 4
  demo/saucedemo/tests/cart/cart.spec.ts
    - demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/cart/cart.spec.ts
  demo/saucedemo/tests/checkout/checkout.spec.ts
    - demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/checkout/checkout.spec.ts
Changed files: 1
specs    demo/saucedemo/pages/cart-page.ts  Used by spec files: 2
```

With `--base`, a `Merge base: <sha>` line comes first. In mode `full`, a `Full suite reasons:` block follows the specs. A `Warnings:` block comes last when there are warnings.

### Select JSON Shape

`--json` prints one object, with keys always in this order:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Always `1` |
| `source` | The diff source, as in the `diff` command |
| `mode` | `none`, `subset` or `full` |
| `playwrightDir` | The Playwright folder from the config |
| `totalSpecs`, `totalTests` | Counts in the Playwright inventory. A test that runs in two projects counts once |
| `selected[]` | `{ file, testCount, tags, reasons }`, sorted by file. In mode `full` this is every spec |
| `fullSuiteReasons` | Why the full suite runs, sorted. Empty unless the mode is `full` |
| `decisions[]` | `{ path, fileClass, status, outcome, reason, specs }`: one per changed path and one per rename old path, sorted by path, then status. `outcome` is `ignored`, `none`, `specs` or `full` |
| `warnings` | Import graph warnings, for example `Unresolved import "<specifier>" in <file>`, sorted |

Tags are written as in the source, with the `@`. Playwright's JSON list drops the `@`, and the inventory puts it back. Lists are sorted in plain code unit order and there are no timestamps, so the same input gives byte identical output.

Real output of `node dist/cli.js select --diff-file tests/fixtures/diffs/modify.diff --json`:

```json
{
  "schemaVersion": 1,
  "source": {
    "type": "file",
    "path": "tests/fixtures/diffs/modify.diff"
  },
  "mode": "subset",
  "playwrightDir": "demo/saucedemo",
  "totalSpecs": 4,
  "totalTests": 8,
  "selected": [
    {
      "file": "demo/saucedemo/tests/cart/cart.spec.ts",
      "testCount": 2,
      "tags": [
        "@cart"
      ],
      "reasons": [
        "demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/cart/cart.spec.ts"
      ]
    },
    {
      "file": "demo/saucedemo/tests/checkout/checkout.spec.ts",
      "testCount": 2,
      "tags": [
        "@checkout"
      ],
      "reasons": [
        "demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/checkout/checkout.spec.ts"
      ]
    }
  ],
  "fullSuiteReasons": [],
  "decisions": [
    {
      "path": "demo/saucedemo/pages/cart-page.ts",
      "fileClass": "test-support",
      "status": "modified",
      "outcome": "specs",
      "reason": "Used by spec files: 2",
      "specs": [
        "demo/saucedemo/tests/cart/cart.spec.ts",
        "demo/saucedemo/tests/checkout/checkout.spec.ts"
      ]
    }
  ],
  "warnings": []
}
```

### Select Limits

- Selection is per spec file, not per test.
- Only relative imports are followed. tsconfig paths and package aliases are not.
- `import(variable)` and `require(variable)` cannot be seen. Only a plain string argument is.
- Files read at run time, such as data files and images, are not tracked. They run the full suite unless an area or an ignore pattern covers them.
- A changed file that no rule maps runs the full suite.
- `--root` must be the repository root, because diff paths are relative to it.
- The inventory and the import graph are read from the files under `--root`, so that checkout should be the head of the diff. If another commit is checked out, the result reflects that checkout.
- Areas come after rule 8, so an area cannot pick specs for a support script that no spec imports.
- Playwright leaves a spec file with no tests out of its list, so such a file is not in the inventory. A Playwright folder with no tests at all exits 2 with `No tests found`.
- The config file keys are only the four above.
- The command prints JSON to stdout and does not write an artifact file yet.

## Roadmap

- PR 1: scaffold and demo suite (done)
- PR 2: diff reader (done)
- PR 3: test inventory and impact mapping (done)
- PR 4: test runner and result parsing
- PR 5: PR summary formatter
- PR 6: GitHub Action and PR comment
- PR 7: missing test suggestions
- PR 8: optional LLM ranking
- PR 9: safety and cost guards
- PR 10: eval fixtures and docs

## License

MIT. See [LICENSE](LICENSE).
