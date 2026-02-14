# Scheduler Flow (Single Source of Truth)

Use this document for all scheduler runs.


## Canonical artifact paths

All daily/weekly prompt files must reference run artifacts using these canonical directories:

- `src/context/CONTEXT_<timestamp>.md`
- `src/todo/TODO_<timestamp>.md`
- `src/decisions/DECISIONS_<timestamp>.md`
- `src/test_logs/TEST_LOG_<timestamp>.md`

Prompt authors: do not use legacy unprefixed paths (`context/`, `todo/`, `decisions/`, `test_logs/`).


## Shared Agent Run Contract (Required for All Spawned Agents)

Every agent prompt invoked by the schedulers (daily/weekly) MUST enforce this contract:

1. **Read baseline policy files before implementation**:
   - `AGENTS.md`
   - `CLAUDE.md`
   - `KNOWN_ISSUES.md`
   - Canonical path note: active issues are tracked in root `KNOWN_ISSUES.md` (not `docs/KNOWN_ISSUES.md`)
   - `docs/agent-handoffs/README.md`
   - Recent notes in `docs/agent-handoffs/learnings/` and `docs/agent-handoffs/incidents/`
2. **Update run artifacts** in `src/context/`, `src/todo/`, `src/decisions/`, and `src/test_logs/` during the run, or explicitly document why each artifact update is not needed for that run.
3. **Capture reusable failures and unresolved issues**:
   - Record reusable failures in `docs/agent-handoffs/incidents/`
   - Record active unresolved reproducible items in `KNOWN_ISSUES.md`
4. **Publish lock completion only after validation passes and before writing success logs**:
   - Run `npm run lock:complete -- --agent <agent-name> --cadence <cadence>` (or equivalent `complete`) successfully
   - If any validation command exits non-zero, do **not** call `lock:complete`; write `_failed.md` with the validation failure reason and stop
   - Only after completion publish succeeds may the agent write final `*_completed.md` log files

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

   Canonical exclusion rule:
   - Use `excluded` from the `npm run lock:check:<cadence>` JSON output.
   - If `excluded` is unavailable, fallback to the union of `locked`, `paused`, and `completed` from that same JSON payload.

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
   - Let `roster` be that ordered array and `excluded` be the set from step 2's canonical exclusion rule.
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

9. Run repository checks (for example: `npm run lint`).

   - If any validation command exits non-zero: **fail the run immediately**, write `_failed.md` with the failing command and reason, and stop.
   - When step 9 fails, step 10 MUST NOT be executed (`lock:complete` is forbidden until validation passes).

10. Publish completion before writing final success log:

    ```bash
    AGENT_PLATFORM=<platform> \
    npm run lock:complete -- --agent <agent-name> --cadence <cadence>
    ```

    (Equivalent invocation is allowed: `torch-lock complete --agent <agent-name> --cadence <cadence>`.)

    - Exit `0`: completion published successfully; continue to step 11.
    - Exit non-zero: **fail the run**, write `_failed.md` with a clear reason that completion publish failed and retry guidance (for example: `Retry npm run lock:complete -- --agent <agent-name> --cadence <cadence> after verifying relay connectivity`), then stop.

11. Create final task log only after step 10 succeeds:

    - `_completed.md` MUST be created only after completion publish succeeds.
    - `_failed.md` is required when step 9 or step 10 fails, and should include the failure reason and next retry action.

12. Commit and push.

Worked post-task example (MUST order):

1. `AGENT_PLATFORM=codex npm run lock:lock -- --agent content-audit-agent --cadence daily`
2. Execute `src/prompts/daily/content-audit-agent.md`
3. `AGENT_PLATFORM=codex npm run lock:complete -- --agent content-audit-agent --cadence daily` (complete, permanent)
4. Write `task-logs/daily/2026-02-14T10-00-00Z__content-audit-agent__completed.md`

Worked validation-failure example (MUST behavior):

1. `AGENT_PLATFORM=codex npm run lock:lock -- --agent content-audit-agent --cadence daily`
2. Execute `src/prompts/daily/content-audit-agent.md`
3. `npm run lint` exits non-zero (or `npm test` exits non-zero)
4. Write `task-logs/daily/2026-02-14T10-00-00Z__content-audit-agent__failed.md` with the failing command and reason
5. Stop the run **without** calling `npm run lock:complete -- --agent content-audit-agent --cadence daily`
