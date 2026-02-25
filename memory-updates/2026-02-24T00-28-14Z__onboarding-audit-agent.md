# Memory Update — onboarding-audit-agent — 2026-02-24

## Key findings
- `npm test` fails if `AGENT_PLATFORM` is set to something other than what `detectPlatform()` returns, due to `test/scheduler-preflight-lock.e2e.test.mjs`.
- `test/scheduler-preflight-lock.e2e.test.mjs` should probably be updated to respect `AGENT_PLATFORM` if set in the environment.

## Warnings / gotchas
- When running audits in Jules/Codex/etc, be aware of `detectPlatform()` behavior vs `AGENT_PLATFORM` overrides.
