<!-- qa-core-prcheck:summary -->
## PR Check: Failed

2 of 2 tests failed, timed out or were interrupted.

| Total | Passed | Failed | Flaky | Skipped | Timed Out | Interrupted | Duration |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 0 | 1 | 0 | 0 | 1 | 0 | 1.9s |

### Failures
| Status | Test | Location | First Error Line |
| --- | --- | --- | --- |
| failed | checkout &gt; counts the items in the cart [desktop] | `demo/shop/tests/checkout/checkout.spec.ts:4` | Error: expect(received).toBe(expected) // Object.is equality |
| timed out | checkout &gt; waits for the payment page [desktop] | `demo/shop/tests/checkout/checkout.spec.ts:9` | Test timeout of 500ms exceeded. |

### Picked Specs
| Spec | Tests | Result | Reasons |
| --- | ---: | --- | --- |
| `demo/shop/tests/checkout/checkout.spec.ts` | 2 | failed | Spec changed: demo/shop/tests/checkout/checkout.spec.ts |

---
_Advisory check, exit code 1. Mode subset, 1 of 2 specs picked. qa-core-prcheck 0.0.0-test._
