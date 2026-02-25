# Onboarding Audit Report - 2026-02-24

## Headline
⚠️ Onboarding failures found

## Environment
- OS: Linux (Jules)
- Node: v22.22.0
- npm: 11.7.0

## Steps Executed
1. `npm install`
2. `npm run build`
3. `npm test`
4. `npm run lint`

## Results
- `npm install`: PASS
- `npm run build`: PASS
- `npm test`: FAIL (Exit Code 1)
- `npm run lint`: PASS

## Failures

### `npm test`
The test `test/scheduler-preflight-lock.e2e.test.mjs` failed due to a platform mismatch.
The test expects the platform in the log to match `detectPlatform()` (which is `jules` in this environment), but the scheduler used `linux` (explicitly set via `AGENT_PLATFORM` for this audit run).
This is a known issue (`KNOWN-ISSUE-scheduler-preflight-platform`).

**Log Excerpt:**
```
not ok 1 - lock preflight e2e: successful lock writes completed status snapshot
  ---
  actual:
    platform: 'linux'
  expected:
    platform: 'jules'
```

**Root Cause:**
The test `test/scheduler-preflight-lock.e2e.test.mjs` asserts that the logged platform matches `detectPlatform()`, ignoring any `AGENT_PLATFORM` environment variable that might have been passed to the scheduler. When `AGENT_PLATFORM` is set manually, the scheduler uses it, causing a mismatch with the test's hardcoded expectation.

## Docs Changes
- None made. The instructions in `README.md` are correct for a default run.
