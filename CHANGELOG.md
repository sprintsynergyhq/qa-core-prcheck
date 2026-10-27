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
