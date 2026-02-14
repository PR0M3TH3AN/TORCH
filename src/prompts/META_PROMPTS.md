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
4) Select next roster agent using this exact algorithm:
   - Read roster from src/prompts/roster.json (`daily` key).
   - Find `latest_file` from step 3.
   - Derive `previous_agent` from that file with precedence:
     a) YAML frontmatter key `agent`.
     b) Filename format `<timestamp>__<agent-name>__<status>.md`.
   - If no valid previous log exists (missing file, parse failure, or agent not in roster):
     - Read `scheduler.firstPromptByCadence.daily` from `torch-config.json` if present.
     - If that agent is in roster, start there.
     - Otherwise set `start_index = 0`.
   - Else set `start_index = (index(previous_agent)+1) mod roster_length`.
   - Round-robin from `start_index`, skipping excluded agents and wrapping with modulo until one eligible agent is found.
   - If none are eligible, write `_failed.md` with reason `All roster tasks currently claimed by other agents` and stop.

   Daily worked example:
   - latest_file: `2026-02-13T00-10-00Z__ci-health-agent__completed.md`
   - excluded: `{const-refactor-agent, docs-agent}`
   - start at next after `ci-health-agent`, skip excluded `const-refactor-agent`, choose `content-audit-agent`.
5) Claim via repository lock:
   AGENT_PLATFORM=<platform> npm run lock:lock -- --agent <agent-name> --cadence daily
   Exit 0 = lock acquired, proceed. Exit 3 = race lost, go back to step 3.
6) Execute selected prompt from src/prompts/daily/
7) Run repository checks (for example: npm run lint)
8) Publish completion before writing `_completed.md`:
   AGENT_PLATFORM=<platform> npm run lock:complete -- --agent <agent-name> --cadence daily
   (Equivalent command allowed: torch-lock complete --agent <agent-name> --cadence daily)
   - Exit 0: continue.
   - Exit non-zero: fail the run, write `_failed.md` with a clear completion-publish failure reason and retry guidance, then stop.
9) Only after step 8 succeeds, write final task log (`_completed.md` for success, `_failed.md` for failure), commit, push

   Worked example (required order):
   - `AGENT_PLATFORM=codex npm run lock:lock -- --agent content-audit-agent --cadence daily`
   - execute selected prompt work
   - `AGENT_PLATFORM=codex npm run lock:complete -- --agent content-audit-agent --cadence daily` (complete, permanent)
   - write `task-logs/daily/<timestamp>__content-audit-agent__completed.md`

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
4) Select next roster agent using this exact algorithm:
   - Read roster from src/prompts/roster.json (`weekly` key).
   - Find `latest_file` from step 3.
   - Derive `previous_agent` from that file with precedence:
     a) YAML frontmatter key `agent`.
     b) Filename format `<timestamp>__<agent-name>__<status>.md`.
   - If no valid previous log exists (missing file, parse failure, or agent not in roster):
     - Read `scheduler.firstPromptByCadence.weekly` from `torch-config.json` if present.
     - If that agent is in roster, start there.
     - Otherwise set `start_index = 0`.
   - Else set `start_index = (index(previous_agent)+1) mod roster_length`.
   - Round-robin from `start_index`, skipping excluded agents and wrapping with modulo until one eligible agent is found.
   - If none are eligible, write `_failed.md` with reason `All roster tasks currently claimed by other agents` and stop.

   Weekly worked example:
   - latest_file: `2026-02-09T00-00-00Z__weekly-synthesis-agent__completed.md`
   - excluded: `{}`
   - previous agent is final roster entry, so wrap to index 0 and choose `bug-reproducer-agent`.
5) Claim via repository lock:
   AGENT_PLATFORM=<platform> npm run lock:lock -- --agent <agent-name> --cadence weekly
   Exit 0 = lock acquired, proceed. Exit 3 = race lost, go back to step 3.
6) Execute selected prompt from src/prompts/weekly/
7) Run repository checks (for example: npm run lint)
8) Publish completion before writing `_completed.md`:
   AGENT_PLATFORM=<platform> npm run lock:complete -- --agent <agent-name> --cadence weekly
   (Equivalent command allowed: torch-lock complete --agent <agent-name> --cadence weekly)
   - Exit 0: continue.
   - Exit non-zero: fail the run, write `_failed.md` with a clear completion-publish failure reason and retry guidance, then stop.
9) Only after step 8 succeeds, write final task log (`_completed.md` for success, `_failed.md` for failure), commit, push

   Worked example (required order):
   - `AGENT_PLATFORM=codex npm run lock:lock -- --agent bug-reproducer-agent --cadence weekly`
   - execute selected prompt work
   - `AGENT_PLATFORM=codex npm run lock:complete -- --agent bug-reproducer-agent --cadence weekly` (complete, permanent)
   - write `task-logs/weekly/<timestamp>__bug-reproducer-agent__completed.md`

MUST 4: If all weekly agents are excluded, stop and write `_failed.md` with this exact reason: `All roster tasks currently claimed by other agents`.
```
