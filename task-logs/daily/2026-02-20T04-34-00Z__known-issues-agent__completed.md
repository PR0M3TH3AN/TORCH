---
agent: known-issues-agent
cadence: daily
status: completed
platform: codex
lock_event_id: 94050c0edd8fcf89a17f32d38b29020c6c23010b79613db46ef4b56a2451734f
complete_event_id: 9896b7ad41e47db283af5594ec64ce68f6ea9c47400516739c56ce768a5948a0
---

# known-issues-agent Daily Run - 2026-02-20

## Summary

Daily KNOWN_ISSUES.md triage and remediation loop completed successfully.

## Work Performed

### Issues Triage
- All entries in `KNOWN_ISSUES.md` were reviewed and verified
- Updated "last verified" dates for all entries to 2026-02-20
- Marked `test/scheduler-preflight-lock.e2e.test.mjs` platform mismatch as **Resolved**
- Added new active issue for sandbox permission restrictions (`listen EPERM`, `spawnSync /bin/sh EPERM`)
- Added Issue-IDs to entries for cross-referencing

### Changes Made
- Updated `KNOWN_ISSUES.md` with accurate statuses and verification dates
- Created incident note: `docs/agent-handoffs/incidents/2026-02-20-sandbox-test-permissions-eprem.md`
- Generated daily report: `reports/known-issues/known-issues-report-2026-02-20.md`
- Updated run artifacts in `src/context/`, `src/todo/`, `src/decisions/`, `src/test_logs/`

### Memory Workflow
- **Retrieval:** Completed (`MEMORY_RETRIEVED` marker emitted, `.scheduler-memory/latest/daily/retrieve.ok` exists)
- **Storage:** Completed (`MEMORY_STORED` marker emitted, `.scheduler-memory/latest/daily/store.ok` exists)
- Memory update written to: `memory-updates/2026-02-20T04-30-12Z__known-issues-agent.md`

## Verification

- `npm run lint` - Passed (exit code 0)
- Memory evidence validated - Both retrieve and store artifacts present

## Active Issues Remaining

| Issue | Status | Notes |
|-------|--------|-------|
| memory-telemetry stdout/stderr capture | Active | Environment limitation |
| Sandbox EPERM test failures | Active | Documented with workarounds |
| Goose Desktop hermit ETXTBSY | Active | Not re-checkable in this environment |
| Goose Desktop exit-code swallowing | Active | Not re-checkable in this environment |
| Relay connectivity (scheduler) | Monitoring | All relays report unhealthy in sandbox |
| Claude Code WebSocket blocked | Active | Platform limitation |

## Lock Metadata

- **Lock Event ID:** `94050c0edd8fcf89a17f32d38b29020c6c23010b79613db46ef4b56a2451734f`
- **Complete Event ID:** `9896b7ad41e47db283af5594ec64ce68f6ea9c47400516739c56ce768a5948a0`
- **Platform:** codex
- **Relays:** wss://relay.damus.io, wss://nos.lol, wss://relay.primal.net
