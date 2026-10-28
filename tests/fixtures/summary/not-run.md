<!-- qa-core-prcheck:summary -->
## PR Check: Not Run (Dry Run)

Dry run: the Playwright command was built and no test ran.

### Picked Specs
| Spec | Tests | Result | Reasons |
| --- | ---: | --- | --- |
| `demo/saucedemo/tests/cart/cart.spec.ts` | 2 | not run | demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/cart/cart.spec.ts |
| `demo/saucedemo/tests/checkout/checkout.spec.ts` | 2 | not run | demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/checkout/checkout.spec.ts |

---
_Advisory check, exit code 0. Mode subset, 2 of 4 specs picked. qa-core-prcheck 0.0.0-test._
