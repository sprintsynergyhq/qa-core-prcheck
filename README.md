# Qa-core-prcheck

A CI agent for GitHub Actions that reads a pull request diff, picks the Playwright tests the change can affect, runs only those, suggests missing tests and posts one pass or fail summary before merge.

## Status

PR 1 of 10: scaffold and demo suite only. The agent does not pick or run tests yet. The CLI only prints its version and its help text.

## Requirements

- Node 22.6 or later
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

## Roadmap

- PR 2: diff reader
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
