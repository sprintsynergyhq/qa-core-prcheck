<!-- qa-core-prcheck:summary -->
## PR Check: Error

The check could not finish, so the test result is unknown. See Errors below.

### Picked Specs
| Spec | Tests | Result | Reasons |
| --- | ---: | --- | --- |
| `demo/saucedemo/tests/cart/cart.spec.ts` | 2 | not run | demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/cart/cart.spec.ts |
| `demo/saucedemo/tests/checkout/checkout.spec.ts` | 2 | not run | demo/saucedemo/pages/cart-page.ts is imported by demo/saucedemo/tests/checkout/checkout.spec.ts |

### Errors
- demo/shop/tests/inventory/inventory.spec.ts:3: Error: inventory data file is missing

### Warnings
- No tests ran for the selected specs

---
_Advisory check, exit code 2. Mode subset, 2 of 4 specs picked. qa-core-prcheck 0.0.0-test._
