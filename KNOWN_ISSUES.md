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
- **Workaround:** Run relay preflight (`npm run lock:health -- --cadence <daily|weekly>`) and inspect `task-logs/relay-health/<cadence>.jsonl` for trend/alert data before rerunning scheduler. If scheduler logs `All relays unhealthy preflight`, treat it as an incident signal, defer lock attempts, and escalate relay/network checks (DNS/TLS/connectivity).
- **Impact:** Scheduled agent execution may be deferred early when all relays are unhealthy, preventing noisy lock retries until relay health recovers.
- **Related notes:** `docs/agent-handoffs/learnings/2026-02-15-relay-health-preflight-job.md`
- **Last verified:** 2026-02-15

