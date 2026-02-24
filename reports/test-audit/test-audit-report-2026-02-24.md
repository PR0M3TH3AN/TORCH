# Test Audit Report: 2026-02-24

## Executive Summary
Executed test audit using `run-flaky-check.mjs` and `run-static-analysis.mjs`. The audit focused on unit and integration tests run by the Node.js test runner. Playwright tests were excluded from the flaky check to prevent false positives caused by runner incompatibility.

**Result:** No flakiness observed in the audited suite.

## Methodology
- **Flaky Check**: Executed `run-flaky-check.mjs` with 5 iterations.
  - Command: `node scripts/test-audit/run-flaky-check.mjs test/*.test.mjs test/*.test.js`
  - Reason for custom arguments: The default behavior of `run-flaky-check.mjs` recursively discovers all files in `test/`, inadvertently attempting to run Playwright specs (`test/playwright/*.spec.js`) with the Node.js test runner, causing immediate failure.
- **Static Analysis**: Executed `run-static-analysis.mjs` to identify anti-patterns (e.g., `setTimeout`).

## Findings

### 1. Flakiness
- **Pass Rate**: 100% (5/5 runs passed for all 381 tests).
- **Matrix**: `reports/test-audit/flakiness-matrix.json` confirms stable execution.

### 2. Static Analysis (Suspicious Patterns)
The analysis flagged usage of `setTimeout`, which can lead to non-deterministic behavior (flakiness) or slow tests.

| File | Issue | Assessment |
| :--- | :--- | :--- |
| `test/playwright/dashboard.spec.js` | Found `setTimeout()` | **Actionable**. Uses `setTimeout(2000)` to wait for a file write after server shutdown. This is a potential source of flakiness if disk I/O is slow. Recommendation: Replace with a polling mechanism checking for file existence or size change. |
| `test/relay-fanout-quorum.integration.test.mjs` | Found `setTimeout()` | **Valid**. Used within `createRelaySimulatorFixture` to simulate network latency (`delayMs`) for mock relays. This is a controlled usage for testing timeout logic. |
| `test/utils-async.test.mjs` | Found `setTimeout()` | **Valid**. This file tests async utilities (including `withTimeout`), so explicit timer usage is required. |
| `test/fixtures/memory-fixtures.js` | No obvious assertions | **Valid**. This is a fixture file, not a test file. |

## Recommendations
1.  **Tooling**: Update `scripts/test-audit/run-flaky-check.mjs` to align its default test discovery with `npm test` (i.e., `test/*.test.mjs test/*.test.js`) or explicitly exclude `test/playwright/`.
2.  **Refactoring**: Refactor `test/playwright/dashboard.spec.js` to remove the hardcoded 2-second sleep.

## Next Steps
- No immediate critical flakiness to fix.
- Future work should address the tooling alignment and the specific Playwright sleep.
