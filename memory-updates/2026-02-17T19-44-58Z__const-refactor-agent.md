# Memory Update: Constants Refactor

- Discovered hardcoded constants in `src/lock-ops.mjs` duplicating defaults.
- Extracted `DEFAULT_RETRY_ATTEMPTS`, `DEFAULT_RETRY_BASE_DELAY_MS`, etc. to `src/constants.mjs`.
- Refactored `src/lock-ops.mjs` to use these constants.
- Fixed a bug in `src/cmd-check.mjs` where `queryLocksFn` was undefined.
- Verified with unit tests and lint.
