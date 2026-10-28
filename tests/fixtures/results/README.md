# Result Fixtures

Real Playwright JSON reports, read by `tests/run-parse.test.mjs` and `tests/run-runner.test.mjs`.

## How They Were Recorded

A throwaway script outside the repo ran the same command the runner builds and copied the report file:

```bash
node node_modules/@playwright/test/cli.js test --config <root>/<playwrightDir> --reporter=json --pass-with-no-tests [filters]
```

It ran with the root as the working folder, with `PLAYWRIGHT_JSON_OUTPUT_FILE` set to a temp file, and with `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `JENKINS_URL`, `BUILD_URL`, `PW_TEST_REPORTER`, `PLAYWRIGHT_JSON_OUTPUT_NAME`, `PLAYWRIGHT_JSON_OUTPUT_FILE` and `PLAYWRIGHT_JSON_OUTPUT_DIR` removed from the environment first.

| File | Root | Filters | Playwright exit code |
| --- | --- | --- | --- |
| `demo-cart.json` | this repo, against the live SauceDemo site | `/^<root>/demo/saucedemo/tests/cart/cart\.spec\.ts$/` (a subset run) | 0 |
| `synthetic-mixed.json` | a temp project with `demo/shop/` (sources below) | none (a full run) | 1 |
| `top-level-error.json` | a temp project with `demo/shop/` (sources below) | none (a full run) | 1 |

## Versions

- Playwright 1.60.0 (`@playwright/test`, as pinned in `package.json`)
- Node v23.9.0 on macOS

## The Only Edits

The absolute repo path was replaced by `/repo` and the temp project path by `/project`, so no file holds a user name or home folder. Nothing else was changed. Start times, durations, `config.metadata.actualWorkers` and the ANSI color codes in error messages are what the runs wrote.

## Synthetic Project

The temp project had `node_modules` linked to this repo's. No test opens a browser.

`demo/shop/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  retries: 1,
  projects: [
    { name: 'desktop' },
    { name: 'smoke', grep: /@cart/ },
  ],
});
```

`demo/shop/tests/cart/cart.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe('cart', () => {
  test('adds a backpack to the cart', { tag: '@cart' }, () => {
    const cart = ['sauce-labs-backpack'];
    expect(cart).toHaveLength(1);
  });

  test('shows the badge after a retry', ({}, testInfo) => {
    expect(testInfo.retry).toBe(1);
  });

  test.skip('applies a promo code', () => {
    expect(true).toBe(true);
  });

  test('sells the onesie for free', () => {
    test.fail();
    expect(7.99).toBe(0);
  });
});
```

`demo/shop/tests/checkout/checkout.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe('checkout', () => {
  test('counts the items in the cart', () => {
    const cartCount = 1;
    expect(cartCount).toBe(2);
  });

  test('waits for the payment page', async () => {
    test.setTimeout(500);
    await new Promise(() => {});
  });
});
```

## Top-Level Error Project

`demo/shop/playwright.config.ts` is `export default defineConfig({ testDir: './tests' });` with the same import, and `demo/shop/tests/inventory/inventory.spec.ts` throws while Playwright loads it:

```ts
import { test } from '@playwright/test';

throw new Error('inventory data file is missing');

test('lists six products', () => {});
```

## Keeping Them Current

Do not edit these files by hand. To change one, record it again the same way.
