# Decision: Utility Consolidation and Cleanup

**Date:** 2026-02-20
**Agent:** style-agent (via scheduler)

## Context
`src/lock-ops.mjs` and `src/lock-publisher.mjs` had duplicate internal definitions of `withTimeout`, `mergeRelayList`, and `relayListLabel`. `src/lock-ops.mjs` specifically had a syntax error due to duplicate `relayListLabel` declarations (one import, one re-export).

## Decision
1. Move the canonical implementation of `withTimeout` to `src/utils.mjs`.
2. Ensure `src/lock-utils.mjs` correctly re-exports `withTimeout` and `relayListLabel` from `src/utils.mjs`.
3. Remove all local duplicate definitions of these functions in `src/lock-ops.mjs` and `src/lock-publisher.mjs`.
4. Consolidate imports to use `src/utils.mjs` or `src/lock-utils.mjs` consistently.

## Rationale
Reduces code duplication, fixes syntax errors blocking the scheduler, and improves maintainability by having a single source of truth for generic async and collection utilities.

## Consequences
- `src/lock-ops.mjs` is now valid ES module code.
- `test/utils.test.mjs` required an updated import to include `mergeRelayList`.
- `npm run lint` now passes.
