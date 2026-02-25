# Audit Report — 2026-02-24

**Summary**

* Commit: 11b3d191172c62bee3080149ffcf663fa1cf76db
* Date: 2026-02-24T23:22:51Z
* Node: v22.22.0 / OS: Linux

**Metrics**

* **Oversized files:** 27 files (total excess lines: 7737)
  * Top offenders:
    1. `perf/constants-refactor/candidates.json` (1668 lines, excess: 1368)
    2. `landing/index.html` (1567 lines, excess: 1267)
    3. `scripts/agent/run-scheduler-cycle.mjs` (1355 lines, excess: 1055)
    4. `dashboard/app.js` (835 lines, excess: 535)
    5. `reports/test-audit/flakiness-matrix.json` (766 lines, excess: 466)
    6. `test/run-scheduler-cycle-memory-policy.test.mjs` (724 lines, excess: 424)
    7. `src/ops.mjs` (717 lines, excess: 417)
    8. `scripts/agent/load-test.mjs` (641 lines, excess: 341)
    9. `TORCH.md` (593 lines, excess: 293)
    10. `src/services/memory/index.js` (566 lines, excess: 266)

* **Total innerHTML assignments:** 2
  * Offenders:
    1. `dashboard/app.js` — 1
    2. `landing/index.html` — 1

* **Lint failures:** 0

**Delta vs previous**

* *No previous report found for comparison.*

**High-priority items**

* Review `perf/constants-refactor/candidates.json` and `landing/index.html` for size reduction.
* Review `dashboard/app.js` and `landing/index.html` for `innerHTML` usage — consider sanitized templates or `textContent`.

**Artifacts**

* `reports/audit/file-size-report-2026-02-24.json`
* `reports/audit/innerhtml-report-2026-02-24.json`
* `reports/audit/lint-report-2026-02-24.json`
* `reports/audit/raw-check-file-size-2026-02-24.log`
* `reports/audit/raw-check-innerhtml-2026-02-24.log`
* `reports/audit/raw-lint-2026-02-24.log`
