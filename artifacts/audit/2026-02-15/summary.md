# Audit Report — 2026-02-15

**Summary**

* Date: 2026-02-15
* Node: v22.22.0

**Metrics**

* **Oversized files** (selected):
  * `scripts/agent/run-scheduler-cycle.mjs`: 1038 lines (excess: 738)
  * `dashboard/index.html`: 878 lines (excess: 578)
  * `src/lib.mjs`: 715 lines (excess: 415)
  * `test/run-scheduler-cycle-memory-policy.test.mjs`: 599 lines (excess: 299)
  * `src/lock-ops.mjs`: 587 lines (excess: 287)

* **Total innerHTML assignments**: 5
  * `landing/index.html`: 3
  * `dashboard/index.html`: 2

* **Lint failures**: 0 errors, 8 warnings.

**Artifacts**

* `raw-check-file-size.log`
* `raw-check-innerhtml.log`
* `raw-lint.log`
