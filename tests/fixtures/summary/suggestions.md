<!-- qa-core-prcheck:summary -->
## PR Check: Not Run (Dry Run)

Dry run: the Playwright command was built and no test ran.

### Why The Full Suite Was Picked
- No rule maps src/cart/total.ts (app-source) to a test

### Picked Specs
| Spec | Tests | Result | Reasons |
| --- | ---: | --- | --- |
| `demo/shop/tests/cart/cart.spec.ts` | 4 | not run | Part of the full suite run |
| `demo/shop/tests/checkout/checkout.spec.ts` | 2 | not run | Part of the full suite run |
| `demo/shop/tests/inventory/inventory.spec.ts` | 1 | not run | demo/shop/pages/inventory-page.ts is imported by demo/shop/tests/inventory/inventory.spec.ts<br>Part of the full suite run |

### Suggested Tests
| File | Why | Suggested Test |
| --- | --- | --- |
| `demo/shop/pages/about-page.ts` | No spec imports this file. | Add a spec that imports demo/shop/pages/about-page.ts and uses it, or remove the file if nothing needs it. |
| `demo/shop/pages/inventory-page.ts` | sortBy was added or changed here, and no file that imports this one uses it. | Add a test that calls sortBy. |
| `src/cart/total.ts` | No rule or spec maps this file, so it falls back to the full suite. | Add a spec that covers the behaviour in src/cart/total.ts, or map it to a tag with an area in qa-core-prcheck.config.json. |

---
_Advisory check, exit code 0. Mode full, 3 of 3 specs picked. qa-core-prcheck 0.0.0-test._
