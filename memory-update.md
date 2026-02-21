Goal: Audit codebase metrics (file size, innerHTML, lint).
Result: Audit complete.
- Oversized files: 20 new (6,413 excess lines). Top offender: `perf/constants-refactor/candidates.json` (1368 excess).
- innerHTML: 6 assignments in 2 files (`landing/index.html`, `dashboard/index.html`).
- Lint: Passed (0 errors, 42 warnings).
- High-priority: Sanitize innerHTML in `landing/index.html`, decompose `src/lock-ops.mjs`.
