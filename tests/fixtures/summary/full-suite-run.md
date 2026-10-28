<!-- qa-core-prcheck:summary -->
## PR Check: Failed (Full Suite Run)

2 of 7 tests failed, timed out or were interrupted.

| Total | Passed | Failed | Flaky | Skipped | Timed Out | Interrupted | Duration |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 7 | 3 | 1 | 1 | 1 | 1 | 0 | 1.7s |

### Why The Full Suite Was Picked
- Playwright config changed: demo/shop/playwright.config.ts

### Failures
| Status | Test | Location | First Error Line |
| --- | --- | --- | --- |
| failed | checkout &gt; counts the items in the cart [desktop] | `demo/shop/tests/checkout/checkout.spec.ts:4` | Error: expect(received).toBe(expected) // Object.is equality |
| timed out | checkout &gt; waits for the payment page [desktop] | `demo/shop/tests/checkout/checkout.spec.ts:9` | Test timeout of 500ms exceeded. |

### Flaky Tests
| Test | Location | Attempts |
| --- | --- | ---: |
| cart &gt; shows the badge after a retry [desktop] | `demo/shop/tests/cart/cart.spec.ts:9` | 2 |

### Picked Specs
| Spec | Tests | Result | Reasons |
| --- | ---: | --- | --- |
| `demo/shop/tests/cart/cart.spec.ts` | 4 | passed (flaky) | Part of the full suite run |
| `demo/shop/tests/checkout/checkout.spec.ts` | 2 | failed | Part of the full suite run |

---
_Advisory check, exit code 1. Mode full, 2 of 2 specs picked. qa-core-prcheck 0.0.0-test._
