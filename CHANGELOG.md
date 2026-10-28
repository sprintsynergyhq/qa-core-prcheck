# Changelog

## Unreleased

- Repo scaffold: `package.json` with exact pinned dev dependencies, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `.nvmrc` and `.gitignore`.
- `src/version.ts`: reads the version from `package.json` at runtime.
- `src/cli.ts`: CLI stub with `--version` and `--help`. Exit code 0 for ok and 2 for usage errors; 1 is reserved for failing tests.
- `tests/cli.test.mjs`: unit tests for the CLI flags, unknown arguments and extra arguments.
- `tests/demo-suite.test.mjs`: static checks for the demo suite layout, feature tags, Page Object imports, hard sleeps and dashes.
- `demo/saucedemo/playwright.config.ts`: Chromium project against SauceDemo, `data-test` as the test id attribute, retries 0.
- `demo/saucedemo/fixtures/users.ts`: the public SauceDemo demo users and password.
- Page Objects: `LoginPage`, `InventoryPage`, `CartPage` and `CheckoutPage`.
- Tagged specs for login, inventory, cart and checkout.
- `.github/workflows/ci.yml`: typecheck and unit tests on pull requests and pushes to main.
- `README.md`, `CLAUDE.md`, `STATE.md`, `CHANGELOG.md` and the MIT `LICENSE`.
- `src/diff/types.ts`: shared diff types (`ChangedFile`, `DiffResult`, `FileClass` and others) and `DiffError` for expected failures.
- `src/diff/parse.ts`: parser that turns a git unified diff into a sorted list of changed files. It reads hunks by their line counts and handles renames, copies, binary files, mode changes, quoted paths and paths with spaces.
- `src/diff/classify.ts`: built-in rules that give each changed path one of ten file classes.
- `src/diff/git.ts`: git source that diffs the merge base of two refs against the head through `execFile` with fixed flags, with plain errors for bad refs, non-repos, unrelated histories and shallow clones.
- `src/diff/format.ts`: text and JSON formatters for the diff result.
- `src/diff/index.ts`: the public diff API, plus `readDiffFile` for saved diffs.
- `src/cli.ts`: `diff` command with `--base`, `--head`, `--diff-file` and `--json`. Exit code 2 now covers usage and tool errors.
- `tests/fixtures/diffs/`: saved git diffs made in temporary repos, with a README that lists the scenario of each one.
- `.gitattributes`: keeps the saved diff fixtures byte for byte on every platform.
- `tests/helpers/git-repo.mjs`: temporary git repos with an isolated git environment for tests.
- `tests/diff-classify.test.mjs`, `tests/diff-parse.test.mjs`, `tests/diff-git.test.mjs` and `tests/diff-cli.test.mjs`: tests for the classifier, the parser, the git source and the diff command. `tests/cli.test.mjs` follows the new help text.
- `README.md`: Diff Command section with exit codes, the JSON shape, file classes, the shallow clone note and limits.
- `CLAUDE.md`: invariants 11 (git through `execFile` only) and 12 (repo-relative forward slash paths). `STATE.md`: PR 2 state.
- `src/inventory/`: test inventory from `playwright test --list --reporter=json`, run through `execFile` with `CI`, `GITHUB_ACTIONS` and the reporter variables removed. Lists spec files with their test titles, lines, tags (with the `@` restored) and projects, merges a test printed once per project, and reports Playwright errors from the JSON, stderr or the exit code.
- `src/impact/glob.ts`: glob matcher with `*`, `**`, `**/` and `?` on repo-relative paths, no library.
- `src/impact/config.ts`: loader for the optional `qa-core-prcheck.config.json` (`playwrightDir`, `areas`, `fullSuiteOn`, `ignore`) with plain errors that name the key.
- `src/impact/imports.ts`: import scanner that finds module specifiers in import, export, dynamic import and require forms, skipping comments, strings, template literals and regular expressions.
- `src/impact/graph.ts`: static import graph from the specs and the Playwright config through relative imports, with extensionless, `.js` to `.ts` and index resolution, cycle safety, and warnings for unresolved imports and imports outside the repository.
- `src/impact/map.ts`: rule based mapper from changed files to a Selection (`none`, `subset` or `full`) with a written reason for every decision and every selected spec, including the import chain.
- `src/impact/format.ts`: text and JSON formatters for the Selection. `src/impact/select.ts`: `selectTests`, which ties config, inventory, graph and mapper together.
- `src/cli.ts`: `select` command with `--base`, `--head`, `--diff-file`, `--root` and `--json`. The top-level help lists it.
- `tests/fixtures/inventory/`: the recorded `--list --reporter=json` output of the demo suite, with a README on how it was recorded.
- `tests/impact-glob.test.mjs`, `tests/impact-config.test.mjs`, `tests/impact-imports.test.mjs`, `tests/impact-graph.test.mjs`, `tests/inventory.test.mjs`, `tests/impact-map.test.mjs` and `tests/select-cli.test.mjs`: tests for the new modules and the select command. `tests/cli.test.mjs` and `tests/diff-cli.test.mjs` follow the new help text.
- `README.md`: Select Command section with exit codes, modes, the rules, the config file, the glob syntax, the JSON shape and limits.
- `CLAUDE.md`: invariants 13 (a reason for every pick, full suite for unmapped files), 14 (deterministic sorted output) and 15 (Playwright through `execFile` only). `STATE.md`: PR 3 state.
