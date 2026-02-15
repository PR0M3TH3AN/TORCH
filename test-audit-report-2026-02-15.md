# Test Audit Report 2026-02-15

## Summary
- **Test Runner**: Node.js --test
- **Coverage**: ~64% Line Coverage
- **Flakiness**: 0 flaky tests found in 5 runs.
- **Static Analysis**: 5 files flagged for timeouts.

## Failing Tests
None found during flakiness check.

## Flakiness
See test-audit/flakiness-matrix.json. All tests passed 5/5 runs.

## Suspicious Tests
The following files contain `setTimeout` or lack assertions:
- test/memory-cache.test.mjs
- test/memory-scheduler.test.mjs
- test/relay-fanout-quorum.integration.test.mjs
- tests/fixtures/memory-fixtures.js (Fixture, expected)
- tests/memory.test.js

## Coverage Gaps
Based on coverage run:
- Overall Line Coverage: 64.37%
- Overall Branch Coverage: 58.20%
- Overall Function Coverage: 75.46%

Critical files with potential gaps:
- src/run-scheduler-cycle.mjs (53% line coverage)
- src/scripts/agent/check-relay-health.mjs (100%)

## Recommendations
1. Replace `setTimeout` with fake timers or deterministic waits where possible.
2. Increase coverage for `run-scheduler-cycle.mjs`.
