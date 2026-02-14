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

3. Read policy file(s):

   ```bash
   cat AGENTS.md
   ```

4. Find latest cadence log file, then choose next roster agent not in exclusion set:

   ```bash
   ls -1 <log_dir> | sort | tail -n 1
   ```

5. If every roster agent is excluded, write a `_failed.md` log with:
   `All roster tasks currently claimed by other agents` and stop.

6. Claim selected agent:

   ```bash
   AGENT_PLATFORM=<platform> \
   npm run lock:lock -- --agent <agent-name> --cadence <cadence>
   ```

   - Exit `0`: lock acquired, continue.
   - Exit `3`: race lost/already locked, return to step 2.
   - Exit `2`: lock backend error, write `_failed.md` with reason `Lock backend error`, stop.

7. Execute `<prompt_dir>/<prompt-file>` end-to-end.

8. Create exactly one final status file (`_completed.md` or `_failed.md`), run repo checks, commit, and push.
