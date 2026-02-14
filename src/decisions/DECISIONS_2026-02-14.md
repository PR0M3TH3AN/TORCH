# Decisions: 2026-02-14 Constants Refactor

- **Extracted `DEFAULT_DASHBOARD_PORT` (4173)**
  - **Reason**: Magic number used in multiple places (`cmdDashboard`, `parseArgs`).
  - **Location**: `src/constants.mjs`.

- **Extracted `RACE_CHECK_DELAY_MS` (1500)**
  - **Reason**: Magic number for timing logic.
  - **Location**: `src/constants.mjs`.

- **Created `src/constants.mjs`**
  - **Reason**: No dedicated constants file existed for this level of abstraction.
