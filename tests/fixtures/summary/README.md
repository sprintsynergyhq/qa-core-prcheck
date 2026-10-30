# Summary Fixtures

Inputs and expected Markdown for `formatSummary`, read by `tests/report-summary.test.mjs` and `tests/check.test.mjs`.

## Inputs

Each file in `inputs/` holds `{ "selection": ..., "result": ... }`: a real `Selection` from `selectTests` and a real `RunResult` from `runSelection`, both from the built code in `dist/`. A throwaway script in the temp folder recorded them and was then removed.

| Input | Diff | Run |
| --- | --- | --- |
| `passed.json` | `tests/fixtures/diffs/modify.diff` on this repo | The fake CLI in `tests/fixtures/fake-playwright/cli.mjs` with `tests/fixtures/results/demo-cart.json`. That report has only the cart spec, so the checkout spec has no tests |
| `failed.json` | A change to `demo/shop/tests/checkout/checkout.spec.ts` (mode `subset`) | Real Playwright 1.60.0, no browser |
| `full-suite-run.json` | A change to `demo/shop/playwright.config.ts` (mode `full`) | Real Playwright 1.60.0, no browser |
| `no-tests-needed.json` | `tests/fixtures/diffs/delete.diff` on this repo | Mode `none`: nothing starts |
| `not-run.json` | `tests/fixtures/diffs/modify.diff` on this repo | `dryRun`: nothing starts |
| `error.json` | `tests/fixtures/diffs/modify.diff` on this repo | The fake CLI with `tests/fixtures/results/top-level-error.json` and exit code 1. The error names a `demo/shop/` file because that report came from the synthetic project |
| `pre-run-error.json` | none | Written by hand: `{ "selection": null, "result": null, "error": ... }`, with the real message `readGitDiff` gives for `--base nope` |
| `spec-deleted.json` | A change that deletes `demo/saucedemo/tests/login/login.spec.ts` | Written by hand: mode `none`, the one decision rule 7 gives a deleted spec, and the `nothing-to-run` result. Without the login spec the demo inventory has 3 specs and 6 tests |
| `suggestions.json` | A change to the synthetic project below that adds a page object method, a page object no spec imports and a `src/` file (mode `full`) | `dryRun`: nothing starts |
| `suggestions-capped.json` | Written by hand from `suggestions.json`: nine more `unimported-support` suggestion objects for made-up page files, kept sorted, 12 in all. Only `selection.suggestions` differs; the decisions are still those of `suggestions.json` | `dryRun`: nothing starts |

`failed.json` and `full-suite-run.json` come from the synthetic project in `tests/fixtures/results/README.md`, without the decoy specs of `tests/run-real.test.mjs`, in a temp git repo made with `tests/helpers/git-repo.mjs`: `.gitignore` first (`node_modules`, `test-results`), `node_modules` linked to this repo's, `qa-core-prcheck.config.json` with `{"playwrightDir":"demo/shop"}`, the sources committed on `main`, then one commit on a branch:

- `failed.json`: branch `feature`, `const cartCount = 1;` becomes `const cartCount = 1; // one backpack`
- `full-suite-run.json`: branch `feature-config`, `testDir: './tests',` becomes `testDir: './tests', // the shop tests`

The diff came from `readGitDiff` with base `main`. Playwright ran with the nine variables then in `REMOVED_ENV_KEYS` removed, `CI` among them. Since PR 6a the runner keeps `CI` and removes the other eight.

`suggestions.json` was recorded in PR 7 the same way, from the built code in `dist/`, with one throwaway script in the temp folder that was then removed. On `main` the temp repo also has `demo/shop/pages/inventory-page.ts` (an `InventoryPage` with `page` and `title`) and `demo/shop/tests/inventory/inventory.spec.ts`, which imports it. One commit on branch `feature` adds `async sortBy(value: string)` to `inventory-page.ts`, adds `demo/shop/pages/about-page.ts`, which no spec imports, and adds `src/cart/total.ts` (class `app-source`). The diff came from `readGitDiff` with base `main`, and `runSelection` ran with `dryRun`. The script checked the suggestions against a list written by hand before the run.

Versions: Playwright 1.60.0, Node v23.9.0 on macOS, git 2.50.1.

## The Only Edits

None, apart from `suggestions-capped.json`, which is written by hand as its row says. The script checked each file for this repo's path, the temp project path and the home folder, ready to replace them with `/repo`, `/project` and `/home`, and found none of them; the PR 7 script also checked for the temp folder. The commit SHAs in the git sources and every duration are what the runs gave. The summary does not show either SHAs or test durations, only the run duration.

## Expected Markdown

Each `<case>.md` was written by hand from the summary layout in `src/report/summary.ts` and the values in its input, before the formatter existed. Do not paste formatter output into them. Every one uses the version `0.0.0-test` in the footer.

| Golden | Input | Notes |
| --- | --- | --- |
| `passed.md` | `passed.json` | |
| `failed.md` | `failed.json` | |
| `full-suite-run.md` | `full-suite-run.json` | |
| `no-tests-needed.md` | `no-tests-needed.json` | |
| `not-run.md` | `not-run.json` | |
| `error.md` | `error.json` | |
| `pre-run-error.md` | `pre-run-error.json` | |
| `spec-deleted.md` | `spec-deleted.json` | The deleted spec lead and its Warnings row |
| `truncated.md` | `failed.json` | `maxBytes` 900, set in the test. The Picked Specs row and the last Failures row are left out |
| `suggestions.md` | `suggestions.json` | One suggestion each of `unimported-support`, `unused-member` and `unmapped-file`. Written in PR 7, before the formatter had the Suggested Tests section |
| `suggestions-capped.md` | `suggestions-capped.json` | Twelve suggestions: the first 10 rows and the cap note. Written in PR 7, before the formatter had the Suggested Tests section |

## Keeping Them Current

To change an input, record it again the same way. To change a golden, edit it by hand from the layout.
