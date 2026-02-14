---
agent: prompt-maintenance-agent
status: failed
---
# Weekly Scheduler Run Failed

reason: Lock backend error

## Details
- cadence: weekly
- log_dir: task-logs/weekly/
- branch_prefix: agents/weekly/
- prompt_dir: src/prompts/weekly/
- excluded: [bug-reproducer-agent, changelog-agent, dead-code-agent, feature-proposer-agent, frontend-console-debug-agent, fuzz-agent, perf-deepdive-agent, perf-optimization-agent, pr-review-agent]
- selected_agent: prompt-maintenance-agent
- lock_command: `AGENT_PLATFORM=codex npm run lock:lock -- --agent prompt-maintenance-agent --cadence weekly`
- lock_exit_code: 2
- next_action: Retry scheduler cycle after relay connectivity is restored.
