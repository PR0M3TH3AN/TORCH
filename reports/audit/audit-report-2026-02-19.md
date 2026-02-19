# Audit Report — 2026-02-19 (main)

**Summary**

* Commit: `aa53554b06f985614a872662a3b9cf8bb451f3c9`
* Date: 2026-02-19 ~20:00 UTC
* Node: v22.22.0 / OS: Linux 6.17.0-14-generic x86_64 Ubuntu
* Branch: `main`
* Run type: First run (no previous report baseline)

---

**Metrics**

* Grandfathered oversized files: 0 (first run — no grandfathered baseline established)
* New oversized files: **20 files** (total excess lines: **6,413**)
* Total innerHTML assignments: **6** (2 files)
* Lint failures (errors): **0** — lint passed (42 warnings, all `no-unused-vars`)

---

**Oversized Files (20 files, 6,413 excess lines)**

| File | Lines | Limit | Excess |
|------|-------|-------|--------|
| `perf/constants-refactor/candidates.json` | 1668 | 300 | 1368 |
| `landing/index.html` | 1361 | 300 | 1061 |
| `dashboard/index.html` | 1044 | 300 | 744 |
| `scripts/agent/run-scheduler-cycle.mjs` | 791 | 300 | 491 |
| `src/lib.mjs` | 738 | 300 | 438 |
| `src/lock-ops.mjs` | 890 | 300 | 590 |
| `test/run-scheduler-cycle-memory-policy.test.mjs` | 614 | 300 | 314 |
| `reports/test-audit/flakiness-matrix.json` | 618 | 300 | 318 |
| `src/ops.mjs` | 477 | 300 | 177 |
| `src/services/memory/index.js` | 467 | 300 | 167 |
| `test/memory-formatter.test.mjs` | 442 | 300 | 142 |
| `test/lock-ops.test.mjs` | 433 | 300 | 133 |
| `test/lib.test.mjs` | 418 | 300 | 118 |
| `scripts/agent/verify-run-artifacts.mjs` | 375 | 300 | 75 |
| `dashboard/styles.css` | 361 | 300 | 61 |
| `src/services/memory/pruner.js` | 320 | 300 | 20 |
| `src/services/memory/scheduler.js` | 318 | 300 | 18 |
| `src/torch-config.mjs` | 312 | 300 | 12 |
| `TORCH.md` | 459 | 300 | 159 |
| `docs/proposals/node-based-prompt-editor.md` | 307 | 300 | 7 |

---

**innerHTML Assignments (6 total)**

Top offenders:

1. `landing/index.html` — 4 assignments
2. `dashboard/index.html` — 2 assignments

---

**Lint Summary**

* Exit code: 0 (pass)
* Total problems: 42 (0 errors, 42 warnings)
* Files affected: 24
* Dominant rule: `no-unused-vars`
* Top lint offenders by warning count:
  1. `src/lock-ops.mjs` — 7 warnings
  2. `src/services/governance/index.js` — 4 warnings
  3. `test/memory-pinning.test.mjs` — 4 warnings
  4. `scripts/agent/smoke-test.mjs` — 2 warnings
  5. `scripts/benchmark-dashboard.mjs` — 2 warnings

---

**Delta vs previous**

* N/A — this is the first audit run. No baseline available.

---

**High-priority items**

No threshold violations requiring immediate escalation, but the following merit attention:

1. `perf/constants-refactor/candidates.json` — 1,368 excess lines (data file; consider compression or splitting)
2. `landing/index.html` — 1,061 excess lines + 4 innerHTML assignments (highest innerHTML risk; consider sanitized templates)
3. `src/lock-ops.mjs` — 590 excess lines (core module; consider decomposition into smaller modules)
4. `scripts/agent/run-scheduler-cycle.mjs` — 491 excess lines (agent orchestration; review for decomposition opportunities)
5. `dashboard/index.html` — 744 excess lines + 2 innerHTML assignments
6. `src/lib.mjs` — 438 excess lines (core library; similar decomposition opportunity)

**innerHTML remediation guidance:**
- `landing/index.html` and `dashboard/index.html` use `innerHTML` — review each assignment:
  - If setting static HTML: prefer `textContent` or DOM construction
  - If inserting dynamic content: use a sanitized templating approach (e.g., `DOMPurify`, `Sanitizer API`, or structured DOM methods)

**Lint guidance:**
- All 42 warnings are `no-unused-vars`. No blocking errors.
- Suggested action: clean up unused variables in `src/lock-ops.mjs` (7 warnings), `src/services/governance/index.js` (4 warnings), and test files.

---

**Thresholds check**

| Threshold | Configured | Actual | Status |
|-----------|------------|--------|--------|
| max_new_oversized_files | 5 | 20 | ⚠ EXCEEDED (first run) |
| max_excess_lines_total | 500 | 6413 | ⚠ EXCEEDED (first run) |
| max_innerHTML_increase_pct | 20% | N/A (first run) | — |
| max_new_lint_failures (errors) | 0 | 0 | ✓ PASS |

Note: threshold exceedances on the first run are expected (no baseline). Recommend establishing these 20 files as the grandfathered baseline for future comparison.

---

**Artifacts**

* `reports/audit/raw-check-file-size-2026-02-19.log` — raw file size audit output
* `reports/audit/raw-check-innerhtml-2026-02-19.log` — raw innerHTML audit output
* `reports/audit/raw-lint-2026-02-19.log` — raw lint output
* `reports/audit/file-size-report-2026-02-19.json` — parsed file size metrics
* `reports/audit/innerhtml-report-2026-02-19.json` — parsed innerHTML metrics
* `reports/audit/lint-report-2026-02-19.json` — parsed lint metrics
* `src/test_logs/TEST_LOG_2026-02-19T20-00-00Z.md` — full command log

---

**Suggested next steps**

1. Establish a grandfathered baseline from this report (approve the 20 files as known-large).
2. Review `landing/index.html` and `dashboard/index.html` for innerHTML usage — prioritize sanitization.
3. Consider decomposing `src/lock-ops.mjs` (890 lines) and `src/lib.mjs` (738 lines).
4. Clean up `no-unused-vars` warnings in `src/lock-ops.mjs` and `src/services/governance/index.js`.
5. Archive `perf/constants-refactor/candidates.json` or exclude it from the file size limit check if it is a generated artifact.
