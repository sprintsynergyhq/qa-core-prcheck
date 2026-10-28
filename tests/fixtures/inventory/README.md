# Inventory Fixtures

## How It Was Recorded

`demo-list.json` is the stdout of the same command `readInventory` runs for the demo suite:

```bash
node node_modules/@playwright/test/cli.js test --list --reporter=json --config <repo>/demo/saucedemo
```

It ran with the repo root as the working folder and with `CI`, `GITHUB_ACTIONS`, `PW_TEST_REPORTER`, `PLAYWRIGHT_JSON_OUTPUT_NAME`, `PLAYWRIGHT_JSON_OUTPUT_FILE` and `PLAYWRIGHT_JSON_OUTPUT_DIR` removed from the environment. A throwaway script outside the repo ran it and saved the output.

## Versions

- Playwright 1.60.0 (`@playwright/test`, as pinned in `package.json`)
- Node v23.9.0 on macOS

## The One Edit

Every occurrence of the absolute repo path was replaced by `/repo`, so the file holds no user name or home folder. Nothing else was changed. The `stats` block (start time, duration) and `config.workers` are whatever that run printed; the parser does not read them.

## Keeping It Current

`tests/inventory.test.mjs` runs Playwright live and checks that the result matches this file. When the demo specs change, record the file again the same way. Do not edit it by hand.
