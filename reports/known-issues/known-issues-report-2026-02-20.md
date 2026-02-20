# Known Issues Daily Report - 2026-02-20

Headline: ⚠️ Active issues remain; all listed entries were reviewed or explicitly marked not re-checkable in this environment.

## Triage summary

- `test/scheduler-preflight-lock.e2e.test.mjs` platform mismatch: **Resolved** (repro no longer occurs).
- `test/memory-telemetry.test.mjs` stdout/stderr capture mismatch: **Active**.
- Sandbox permission constraints (`listen EPERM`, `spawnSync /bin/sh EPERM`): **Active** (newly documented).
- Goose Desktop hermit ETXTBSY: **Active / not re-checkable here**.
- Goose Desktop exit-code swallowing: **Active / not re-checkable here**.
- Prompt-contract failures in `npm test`: **Resolved**.
- Full-suite timeout/hang: **Resolved** (suite finishes quickly, now fails for other reasons).
- Recurring scheduler lock backend failures: **Monitoring** (lock health still reports all relays unhealthy in this sandbox).
- Claude Code websocket/proxy lock limitation: **Active / not directly re-checkable here**.
- content-audit `/content` path issue: **Resolved**.
- content-audit mission mis-scope issue: **Resolved**.

## Verification commands run

- `node --test test/scheduler-preflight-lock.e2e.test.mjs`
- `node test/memory-telemetry.test.mjs`
- `npm test`
- `node test/dashboard-auth.test.mjs`
- `node test/nostr-lock.test.mjs`
- `node test/ops.test.mjs`
- `npm run lock:health -- --cadence daily`
- `npm run lock:check:daily -- --json --quiet`

## Changes made

- Updated `KNOWN_ISSUES.md` statuses, verification dates, and workarounds.
- Added new active issue for sandbox permission restrictions affecting test execution.
- Added incident note: `docs/agent-handoffs/incidents/2026-02-20-sandbox-test-permissions-eprem.md`.
- Updated required run artifacts in `src/context/`, `src/todo/`, `src/decisions/`, and `src/test_logs/`.

## GitHub issue conversion status

- No GitHub issues were opened from this run due sandbox network/API limitations.
- Medium-scope items are documented with reproducible evidence for issue creation from a network-enabled environment.

## Blockers

- Environment restrictions prevent local socket bind and shell-spawn in some tests.
- Relay DNS/WebSocket access is unavailable from this sandbox for lock-health verification.
