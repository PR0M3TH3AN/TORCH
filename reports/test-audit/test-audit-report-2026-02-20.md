# Test Audit Report - 2026-02-20

## Static Analysis
Found 3 suspicious files:
- `test/fixtures/memory-fixtures.js`: No assertions (False positive: fixture file).
- `test/relay-fanout-quorum.integration.test.mjs`: Found `setTimeout()` (Likely necessary for network integration tests).
- `test/utils-async.test.mjs`: Found `setTimeout()` (Likely testing async utilities).

## Flakiness Check
Ran all tests 5 times.
- **Failures Detected**:
  - `scripts/agent/load-test.mjs`: Failed 5/5 runs.
  - `scripts/agent/smoke-test.mjs`: Failed 5/5 runs.
  - `cmdInit should validate install directory name`: Failed 1/5 runs (Flaky).
- Other tests passed 5/5 runs.
