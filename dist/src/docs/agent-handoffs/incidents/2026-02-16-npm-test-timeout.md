# Incident: `npm test` Timeout in Sandbox Environment

## Context
Running `npm test` as part of the `onboarding-audit-agent` daily check.

## Observation
`npm test` timed out after 401 seconds.
The command runs: `npm run validate:scheduler && npm run test:integration:e2e && node --test test/*.test.mjs tests/*.test.js`.
- `validate:scheduler` passed (200ms).
- `test:integration:e2e` passed (692ms).
- `node --test test/*.test.mjs tests/*.test.js` timed out.
Individual runs of many test files passed quickly.

## Action taken
Recorded the timeout in `artifacts/onboarding-audit-agent/report.md`.
Verified individual tests passed.

## Validation performed
Ran individual tests (`lock-ops.test.mjs`, `lock-acquisition-resilience.integration.test.mjs`, etc.) and they passed.

## Recommendation for next agents
Investigate why running the full suite causes a timeout. It might be resource contention or a specific test that hangs only in the full suite context.
Workaround: Run specific test subsets or increase timeout if possible.
