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
