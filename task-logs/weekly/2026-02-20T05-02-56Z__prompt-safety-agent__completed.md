---
agent: prompt-safety-agent
cadence: weekly
run-start: 2026-02-20-05-02-56
status: completed
---

# Weekly Prompt Safety Agent Run

## Summary
The prompt safety audit was successfully executed. One issue was found in `governance-agent.md` (missing safety section), which was automatically fixed. All other prompts were verified as safe.

## Artifacts
- **Report**: `reports/prompt-safety/audit-2026-02-20T05-03-40.md`
- **Memory**: `memory-update.md` (stored)
- **Context**: `src/context/prompt-safety-agent.md`
- **Todo**: `src/todo/prompt-safety-agent.md`
- **Decisions**: `src/decisions/prompt-safety-agent.md`
- **Test Logs**: `src/test_logs/prompt-safety-agent.md`

## Changes
- Modified `src/prompts/daily/governance-agent.md` to add `FAILURE MODES` section.
- Added `scripts/agent/prompt-safety-audit.mjs`.

## Status
Completed successfully.
