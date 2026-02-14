# Scheduler Flow (Single Source of Truth)

Use this document for all scheduler runs.

## Numbered MUST Procedure

1. Set cadence variables before any command:
   - `cadence` = `daily` or `weekly`
   - `log_dir` = `task-logs/<cadence>/`
   - `branch_prefix` = `agents/<cadence>/`
   - `prompt_dir` = `src/prompts/<cadence>/`

2. Run preflight to build the exclusion set:

   ```bash
   if daily: `npm run lock:check:daily`; if weekly: `npm run lock:check:weekly`
   ```

3. Read policy file(s). This step is conditional: if `AGENTS.md` is missing, continue without failing.

   ```bash
   test -f AGENTS.md && cat AGENTS.md || echo "No AGENTS.md found; continuing"
   ```

4. Bootstrap log directories before listing files:

   ```bash
   mkdir -p <log_dir>
   ```

5. Find latest cadence log file, derive the previous agent, then choose the next roster agent not in exclusion set:

   ```bash
   ls -1 <log_dir> | sort | tail -n 1
   ```

   Selection algorithm (MUST be followed exactly):

   - Roster source: `src/prompts/roster.json` and the key matching `<cadence>`.
   - Let `roster` be that ordered array and `excluded` be the `excluded` set (including paused and locked agents) from the JSON output of step 2.
   - Let `latest_file` be the lexicographically last filename in `<log_dir>`.
   - Determine `previous_agent` from `latest_file` using this precedence:
     1. Parse YAML frontmatter from `<log_dir>/<latest_file>` and use key `agent` when present and non-empty.
     2. Otherwise parse filename convention `<timestamp>__<agent-name>__<status>.md` and take `<agent-name>`.
   - If no valid `latest_file` exists, or parsing fails, or `previous_agent` is not in `roster`, treat as first run fallback.
   - First run fallback:
     - Read `scheduler.firstPromptByCadence.<cadence>` from `torch-config.json` if present.
     - If that agent exists in `roster`, set `start_index = index(configured_agent)`.
     - Otherwise set `start_index = 0`.
   - Otherwise: `start_index = (index(previous_agent in roster) + 1) mod len(roster)`.
   - Round-robin scan:
     - Iterate offsets `0..len(roster)-1`.
     - Candidate index: `(start_index + offset) mod len(roster)` (wrap-around required).
     - Choose the first candidate whose agent is **not** in `excluded`.
   - If no candidate is eligible, execute step 6.

   Worked examples:

   - **Daily example**
     - `roster.daily = [audit-agent, ci-health-agent, const-refactor-agent, ...]`
     - `latest_file = 2026-02-13T00-10-00Z__ci-health-agent__completed.md`
     - `excluded = {const-refactor-agent, docs-agent}`
     - `previous_agent = ci-health-agent`, so `start_index` points to `const-refactor-agent`.
     - `const-refactor-agent` is excluded; skip to `content-audit-agent`.
     - **Selection result: `content-audit-agent`.**

   - **Weekly example**
     - `roster.weekly = [bug-reproducer-agent, changelog-agent, ..., weekly-synthesis-agent]`
     - `latest_file = 2026-02-09T00-00-00Z__weekly-synthesis-agent__completed.md`
     - `excluded = {}`
     - `previous_agent = weekly-synthesis-agent` (last roster entry), so `start_index = 0` by wrap-around.
     - First candidate is `bug-reproducer-agent` and is eligible.
     - **Selection result: `bug-reproducer-agent`.**

6. If every roster agent is excluded, write a `_failed.md` log with:
   `All roster tasks currently claimed by other agents` and stop.

7. Claim selected agent:

   ```bash
   AGENT_PLATFORM=<platform> \
   npm run lock:lock -- --agent <agent-name> --cadence <cadence>
   ```

   - Exit `0`: lock acquired, continue.
   - Exit `3`: race lost/already locked, return to step 2.
   - Exit `2`: lock backend error, write `_failed.md` with reason `Lock backend error`, stop.

8. Execute `<prompt_dir>/<prompt-file>` end-to-end.

9. Create exactly one final status file (`_completed.md` or `_failed.md`), run repo checks, commit, and push.
