# Weekly Agent Scheduler Prompt

Use `src/prompts/scheduler-flow.md` as the authoritative scheduler procedure.

> **Shared contract (required):** Ensure each selected prompt run enforces [`Scheduler Flow → Shared Agent Run Contract`](scheduler-flow.md#shared-agent-run-contract-required-for-all-spawned-agents).

Canonical roster source: `src/prompts/roster.json` (`weekly` key).

## Weekly Cadence Configuration

- `cadence`: `weekly`
- `log_dir`: `task-logs/weekly/`
- `branch_prefix`: `agents/weekly/`
- `prompt_dir`: `src/prompts/weekly/`


## Lock Backend Preflight Behavior

- When `scheduler.lockHealthPreflight` is enabled (or `SCHEDULER_LOCK_HEALTH_PREFLIGHT=1`), run `node scripts/agent/check-relay-health.mjs --cadence weekly` before agent selection/lock attempt.
- On preflight failure, scheduler must write a `_failed.md` entry with reason `Lock backend unavailable preflight`, including relay list + classified preflight failure metadata, `failure_category: lock_backend_error`, and `prompt not executed` summary text before stopping.
- Escape hatch for local/offline workflows: `SCHEDULER_SKIP_LOCK_HEALTH_PREFLIGHT=1`.

## Weekly Roster

| # | Agent Name | Prompt File |
|---|------------|-------------|
| 1 | bug-reproducer-agent | `bug-reproducer-agent.md` |
| 2 | builder-agent | `builder-agent.md` |
| 3 | changelog-agent | `changelog-agent.md` |
| 4 | dead-code-agent | `dead-code-agent.md` |
| 5 | feature-proposer-agent | `feature-proposer-agent.md` |
| 6 | frontend-console-debug-agent | `frontend-console-debug-agent.md` |
| 7 | fuzz-agent | `fuzz-agent.md` |
| 8 | perf-deepdive-agent | `perf-deepdive-agent.md` |
| 9 | perf-optimization-agent | `perf-optimization-agent.md` |
| 10 | plan-agent | `plan-agent.md` |
| 11 | pr-review-agent | `pr-review-agent.md` |
| 12 | prompt-fixer-agent | `prompt-fixer-agent.md` |
| 13 | prompt-gap-analysis-agent | `prompt-gap-analysis-agent.md` |
| 14 | prompt-maintenance-agent | `prompt-maintenance-agent.md` |
| 15 | prompt-safety-agent | `prompt-safety-agent.md` |
| 16 | proposal-triage-agent | `proposal-triage-agent.md` |
| 17 | race-condition-agent | `race-condition-agent.md` |
| 18 | refactor-agent | `refactor-agent.md` |
| 19 | repo-fit-agent | `repo-fit-agent.md` |
| 20 | smoke-agent | `smoke-agent.md` |
| 21 | telemetry-agent | `telemetry-agent.md` |
| 22 | test-coverage-agent | `test-coverage-agent.md` |
| 23 | ui-ux-agent | `ui-ux-agent.md` |
| 24 | weekly-synthesis-agent | `weekly-synthesis-agent.md` |
