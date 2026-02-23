# Known Issues Report - 2026-02-23

## Status: ⚠️ Active issues remain

Most active issues are specific to restricted environments (Codex/Claude/Goose) and do not reproduce in the Jules environment.

### Verification Summary

| Issue ID | Status | Last Verified | Jules Result |
|----------|--------|---------------|--------------|
| `KNOWN-ISSUE-scheduler-preflight-platform` | Active | 2026-02-23 | ✅ Passed |
| `KNOWN-ISSUE-memory-telemetry-stdout-stderr` | Active | 2026-02-23 | ✅ Passed |
| `KNOWN-ISSUE-sandbox-eprem-tests` | Active | 2026-02-23 | ✅ Passed |
| `Goose Desktop: hermit ETXTBSY` | Active | 2026-02-23 | ❓ N/A (Linux/Jules) |
| `Goose Desktop: wrapper exit codes` | Active | 2026-02-23 | ❓ N/A (Linux/Jules) |
| `KNOWN-ISSUE-relay-connectivity-sandbox` | Monitoring | 2026-02-23 | ✅ Healthy |
| `Claude Code: outbound WebSocket` | Active | 2026-02-23 | ✅ Connected |

### Actions Taken
- Verified tests pass in Jules environment.
- Updated `KNOWN_ISSUES.md` to reflect verification status.
- Confirmed relay health and lock acquisition.

### Next Steps
- Continue monitoring relay health.
- Investigate Goose Desktop issues if environment becomes available.
