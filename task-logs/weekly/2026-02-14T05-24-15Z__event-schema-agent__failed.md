---
agent: event-schema-agent
status: failed
---
# Weekly Scheduler Run Failed

reason: Lock backend error

## Details
- cadence: weekly
- excluded: []
- selected_agent: event-schema-agent
- lock_command: `AGENT_PLATFORM=codex npm run lock:lock -- --agent event-schema-agent --cadence weekly`
- lock_exit_code: 2
