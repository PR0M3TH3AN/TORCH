# CI Health Update
- Fixed bug in `src/lock-ops.mjs`: `getRelayFallbacks` is async but was called synchronously in `LockPublisher` constructor.
- Fixed bug in `src/lock-ops.mjs`: `LockPublisher` used `maybeLogHealthSnapshot` which was undefined; updated to use `healthManager`.
- Fixed bug in `src/cmd-check.mjs`: `queryLocksFn` was undefined; updated to use injected `queryLocksFn` or default `queryLocks`.
- Ran `npm run build` to fix `test/build_verification.test.mjs`.
- All tests passed.
