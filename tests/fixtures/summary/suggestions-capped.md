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

Showing the first 10 of 12 suggestions (a chosen limit). The selection JSON lists all of them.

| File | Why | Suggested Test |
| --- | --- | --- |
| `demo/shop/pages/about-page.ts` | No spec imports this file. | Add a spec that imports demo/shop/pages/about-page.ts and uses it, or remove the file if nothing needs it. |
| `demo/shop/pages/burger-menu-page.ts` | No spec imports this file. | Add a spec that imports demo/shop/pages/burger-menu-page.ts and uses it, or remove the file if nothing needs it. |
| `demo/shop/pages/cart-badge-page.ts` | No spec imports this file. | Add a spec that imports demo/shop/pages/cart-badge-page.ts and uses it, or remove the file if nothing needs it. |
| `demo/shop/pages/checkout-complete-page.ts` | No spec imports this file. | Add a spec that imports demo/shop/pages/checkout-complete-page.ts and uses it, or remove the file if nothing needs it. |
| `demo/shop/pages/checkout-overview-page.ts` | No spec imports this file. | Add a spec that imports demo/shop/pages/checkout-overview-page.ts and uses it, or remove the file if nothing needs it. |
| `demo/shop/pages/footer-page.ts` | No spec imports this file. | Add a spec that imports demo/shop/pages/footer-page.ts and uses it, or remove the file if nothing needs it. |
| `demo/shop/pages/header-page.ts` | No spec imports this file. | Add a spec that imports demo/shop/pages/header-page.ts and uses it, or remove the file if nothing needs it. |
| `demo/shop/pages/inventory-page.ts` | sortBy was added or changed here, and no file that imports this one uses it. | Add a test that calls sortBy. |
| `demo/shop/pages/item-detail-page.ts` | No spec imports this file. | Add a spec that imports demo/shop/pages/item-detail-page.ts and uses it, or remove the file if nothing needs it. |
| `demo/shop/pages/product-sort-page.ts` | No spec imports this file. | Add a spec that imports demo/shop/pages/product-sort-page.ts and uses it, or remove the file if nothing needs it. |

---
_Advisory check, exit code 0. Mode full, 3 of 3 specs picked. qa-core-prcheck 0.0.0-test._
