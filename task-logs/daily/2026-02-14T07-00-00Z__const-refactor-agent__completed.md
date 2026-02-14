---
agent: const-refactor-agent
cadence: daily
status: completed
date: 2026-02-14
---

# Constant Refactor

Identified and extracted magic numbers:
- `DEFAULT_DASHBOARD_PORT` (4173)
- `RACE_CHECK_DELAY_MS` (1500)

Created `src/constants.mjs` and updated `src/lib.mjs`.

Verified with `npm run lint` and `npm test`.
