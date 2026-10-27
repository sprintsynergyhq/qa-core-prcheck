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
