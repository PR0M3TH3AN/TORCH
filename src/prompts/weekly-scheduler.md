# Weekly Agent Scheduler Prompt

Use `src/prompts/scheduler-flow.md` as the authoritative scheduler procedure.

Canonical roster source: `src/prompts/roster.json` (`weekly` key).

## Weekly Cadence Configuration

- `cadence`: `weekly`
- `log_dir`: `task-logs/weekly/`
- `branch_prefix`: `agents/weekly/`
- `prompt_dir`: `src/prompts/weekly/`

## Weekly Roster

| # | Agent Name | Prompt File |
|---|------------|-------------|
| 1 | bug-reproducer-agent | `bug-reproducer-agent.md` |
| 2 | changelog-agent | `changelog-agent.md` |
| 3 | dead-code-agent | `dead-code-agent.md` |
| 4 | event-schema-agent | `event-schema-agent.md` |
| 5 | frontend-console-debug-agent | `frontend-console-debug-agent.md` |
| 6 | fuzz-agent | `fuzz-agent.md` |
| 7 | interop-agent | `interop-agent.md` |
| 8 | perf-deepdive-agent | `perf-deepdive-agent.md` |
| 9 | perf-optimization-agent | `perf-optimization-agent.md` |
| 10 | pr-review-agent | `pr-review-agent.md` |
| 11 | race-condition-agent | `race-condition-agent.md` |
| 12 | refactor-agent | `refactor-agent.md` |
| 13 | smoke-agent | `smoke-agent.md` |
| 14 | telemetry-agent | `telemetry-agent.md` |
| 15 | test-coverage-agent | `test-coverage-agent.md` |
| 16 | repo-fit-agent | `repo-fit-agent.md` |
| 17 | weekly-synthesis-agent | `weekly-synthesis-agent.md` |
