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

_Summary shortened to fit 900 bytes: 2 rows or items left out. The full result is in prcheck-results.json._

---
_Advisory check, exit code 1. Mode subset, 1 of 2 specs picked. qa-core-prcheck 0.0.0-test._
