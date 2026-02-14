# KNOWN_ISSUES.md

Track only **active, reproducible, unresolved** issues.

## Entry template

### [Issue title]
- **Status:** Open | Monitoring | Mitigated
- **Area:** Build | Test | Tooling | Runtime | Docs | Other
- **Symptom:**
- **Trigger/Conditions:**
- **Workaround:**
- **Impact:**
- **Related notes:** `docs/agent-handoffs/incidents/...` (optional)
- **Last verified:** YYYY-MM-DD

## Active issues

### `npm test` fails due to prompt contract violations
- **Status:** Active
- **Area:** Tooling
- **Symptom:** `npm test` fails with multiple `[prompt-contract]` errors for missing `lock:complete` tokens in daily/weekly agent prompts.
- **Trigger/Conditions:** Running `npm test`.
- **Workaround:** Run `npm run validate:scheduler` separately and inspect output, or ignore errors for now.
- **Impact:** CI/local testing blocked.
- **Last verified:** 2026-02-14

### Recurring scheduler lock backend failures in recent task logs
- **Status:** Monitoring
- **Area:** Runtime
- **Symptom:** Multiple scheduler runs fail with `Lock backend error` before prompt handoff/validation.
- **Trigger/Conditions:** Running scheduler cycles when relay connectivity is unstable or lock backend operations time out; observed in both `daily` and `weekly` task logs.
- **Workaround:** Retry with explicit platform and inspect reliability report output (`npm run report:lock-reliability`), then validate relay health (`node scripts/agent/check-relay-health.mjs --cadence <daily|weekly>`) before rerunning scheduler.
- **Impact:** Scheduled agent execution is skipped for affected cycles until lock acquisition succeeds.
- **Last verified:** 2026-02-14

