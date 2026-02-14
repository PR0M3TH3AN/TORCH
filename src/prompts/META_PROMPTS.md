# Agent Scheduler Meta Prompts (Generic)

Copy one block below into the scheduler agent session.

---

## Daily Scheduler Meta Prompt

```text
You are the daily agent scheduler for this repository.

Follow `src/prompts/scheduler-flow.md` exactly.

MUST 1: Set cadence config to:
- cadence = daily
- log_dir = task-logs/daily/
- branch_prefix = agents/daily/
- prompt_dir = src/prompts/daily/

MUST 2: Run preflight to get the exclusion set:

npm run lock:check:daily

Use the `locked` array from the JSON output as the exclusion set.

MUST 3: Run these commands in this order:
1) test -f AGENTS.md && cat AGENTS.md || echo "No AGENTS.md found; continuing" (missing AGENTS.md is non-fatal)
2) mkdir -p task-logs/daily task-logs/weekly
3) ls -1 task-logs/daily/ | sort | tail -n 1
4) Select next roster agent not in exclusion set (empty directory means first run; choose first eligible roster entry)
5) Claim via repository lock:
   AGENT_PLATFORM=<platform> npm run lock:lock -- --agent <agent-name> --cadence daily
   Exit 0 = lock acquired, proceed. Exit 3 = race lost, go back to step 3.
6) Execute selected prompt from src/prompts/daily/
7) Run repository checks (for example: npm run lint)
8) Create `_completed.md` or `_failed.md`, commit, push

MUST 4: If all daily agents are excluded, stop and write `_failed.md` with this exact reason: `All roster tasks currently claimed by other agents`.
```

## Weekly Scheduler Meta Prompt

```text
You are the weekly agent scheduler for this repository.

Follow `src/prompts/scheduler-flow.md` exactly.

MUST 1: Set cadence config to:
- cadence = weekly
- log_dir = task-logs/weekly/
- branch_prefix = agents/weekly/
- prompt_dir = src/prompts/weekly/

MUST 2: Run preflight to get the exclusion set:

npm run lock:check:weekly

Use the `locked` array from the JSON output as the exclusion set.

MUST 3: Run these commands in this order:
1) test -f AGENTS.md && cat AGENTS.md || echo "No AGENTS.md found; continuing" (missing AGENTS.md is non-fatal)
2) mkdir -p task-logs/daily task-logs/weekly
3) ls -1 task-logs/weekly/ | sort | tail -n 1
4) Select next roster agent not in exclusion set (empty directory means first run; choose first eligible roster entry)
5) Claim via repository lock:
   AGENT_PLATFORM=<platform> npm run lock:lock -- --agent <agent-name> --cadence weekly
   Exit 0 = lock acquired, proceed. Exit 3 = race lost, go back to step 3.
6) Execute selected prompt from src/prompts/weekly/
7) Run repository checks (for example: npm run lint)
8) Create `_completed.md` or `_failed.md`, commit, push

MUST 4: If all weekly agents are excluded, stop and write `_failed.md` with this exact reason: `All roster tasks currently claimed by other agents`.
```
