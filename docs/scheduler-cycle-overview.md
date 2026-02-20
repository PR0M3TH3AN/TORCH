# Scheduler Cycle Overview (`scripts/agent/run-scheduler-cycle.mjs`)

## What this module does

`run-scheduler-cycle.mjs` is the main scheduler entry point. Given a cadence
(`daily` or `weekly`), it selects the next eligible agent from the roster,
acquires a distributed Nostr lock to prevent duplicate execution across agents,
runs the selected agent's prompt via a configured handoff command, verifies that
required run artifacts and memory evidence were produced, then publishes task
completion.

This script owns the full agent lifecycle for one slot per invocation:
lock acquisition → prompt execution → artifact/memory verification → lock:complete.
Spawned agents must **not** call `lock:complete` themselves — the scheduler does it
after all validation passes.

## Where it fits

```
npm run scheduler:daily
   └─ scripts/agent/run-scheduler-cycle.mjs daily
         ├─ src/prompts/roster.json          (agent list)
         ├─ torch-config.json                (handoff command, memory policy, etc.)
         ├─ scripts/agent/scheduler-utils.mjs
         ├─ scripts/agent/scheduler-lock.mjs
         ├─ npm run lock:check:daily         (relay query)
         ├─ npm run lock:lock                (relay publish)
         ├─ <handoffCommand>                 (spawns the agent)
         ├─ scripts/agent/verify-run-artifacts.mjs
         └─ npm run lock:complete            (relay publish, permanent)
```

## Typical call flow

```
1. Parse args → cadence='daily', platform='codex', model=null

2. Load roster from src/prompts/roster.json → ['audit-agent', 'docs-agent', ...]

3. Read AGENTS.md → print to stdout (best-effort; non-fatal if missing)

4. [LOOP] Read run-state → { run_date: '2026-02-20', lock_deferral: null }

5. [LOOP] Lock health preflight (if enabled):
     npm run lock:health -- --cadence daily
     → non-zero: write _deferred.md or _failed.md, exit

6. [LOOP] npm run lock:check:daily -- --json --quiet
     → exclusion set: { locked: ['ci-health-agent'], paused: [], completed: [] }

7. [LOOP] Time-window guard: exclude agents that ran within 24h window

8. [LOOP] Round-robin select:
     roster = ['audit-agent', 'ci-health-agent', 'docs-agent', ...]
     previous = 'ci-health-agent' (from latest log)
     excluded = { 'ci-health-agent' }
     → selected = 'docs-agent'

9. [LOOP] npm run lock:lock -- --agent docs-agent --cadence daily
     → exit 0: lock acquired (continue)
     → exit 3: race lost (restart loop at step 4)
     → exit 2: backend error → defer (non-strict) or fail (strict)

10. [LOOP] Validate src/prompts/daily/docs-agent.md
      → not readable → _failed.md (prompt_parse_error), exit 1
      → bad first line → _failed.md (prompt_schema_error), exit 1

11. [LOOP] Clear deferral state. Run memory retrieve command (if configured).

12. [LOOP] Run handoff command (e.g. `claude --prompt "$SCHEDULER_PROMPT_PATH"`)
      → non-zero → _failed.md (execution_error), exit non-zero
      → missing → _failed.md, exit 1

13. [LOOP] Run memory store command (if configured).

14. [LOOP] Verify memory evidence (markers/artifacts):
      → mode='required' + missing → _failed.md, exit 1
      → mode='optional' + missing → console.warn, continue

15. [LOOP] node scripts/agent/verify-run-artifacts.mjs --since <runStart>
      → non-zero → _failed.md (prompt_schema_error), exit non-zero

16. [LOOP] npm run lint (or configured validationCommands)
      → non-zero → _failed.md (execution_error), exit non-zero

17. [LOOP] npm run lock:complete -- --agent docs-agent --cadence daily
      → non-zero → _failed.md, exit non-zero

18. [LOOP] Write _completed.md task log. Print run summary. Exit 0.
```

## Public API summary

This is a CLI script — it has no exported functions. The entry point is:

```bash
node scripts/agent/run-scheduler-cycle.mjs <daily|weekly> [--platform <p>] [--model <m>]
# or via npm:
npm run scheduler:daily
npm run scheduler:weekly
```

**Environment variables:**

| Variable | Source | Purpose |
|----------|--------|---------|
| `AGENT_PLATFORM` | env | Platform identifier (codex, claude, linux) |
| `AGENT_MODEL` | env | Model identifier forwarded to lock events |
| `SCHEDULER_LOCK_MAX_RETRIES` | env | Override lock:lock retry count (default: 2) |
| `SCHEDULER_LOCK_BACKOFF_MS` | env | Override base backoff ms (default: 250) |
| `SCHEDULER_LOCK_JITTER_MS` | env | Override jitter ms (default: 75) |
| `SCHEDULER_LOCK_HEALTH_PREFLIGHT` | env | Enable/disable relay health preflight |
| `SCHEDULER_SKIP_LOCK_HEALTH_PREFLIGHT` | env | Skip preflight even if enabled |
| `SCHEDULER_STRICT_LOCK` | env | Override strict_lock policy |
| `SCHEDULER_DEGRADED_LOCK_RETRY_WINDOW_MS` | env | Override deferral window ms |
| `SCHEDULER_MAX_DEFERRALS` | env | Override max deferral count |

**Variables injected into child processes:**

| Variable | Value | Purpose |
|----------|-------|---------|
| `SCHEDULER_AGENT` | selected agent name | Used by handoff/memory commands |
| `SCHEDULER_CADENCE` | `daily`\|`weekly` | Used by handoff/memory commands |
| `SCHEDULER_PROMPT_PATH` | absolute path | Path to prompt file |
| `SCHEDULER_MEMORY_FILE` | absolute path | Agent writes learnings here |

## Key internal functions

| Function | Purpose |
|----------|---------|
| `parseArgs(argv)` | Parses cadence, platform, model from CLI args |
| `getSchedulerConfig(cadence, opts)` | Merges torch-config.json + env overrides |
| `readRunState(cadence)` / `writeRunState(path, state)` | Deferral state persistence (day-scoped) |
| `getLatestFile(logDir)` | Finds most recent valid task log for previous-agent detection |
| `selectNextAgent({roster, excludedSet, previousAgent, firstPrompt})` | Round-robin with exclusion |
| `validatePromptFile(promptPath)` | Reads and validates prompt format |
| `verifyMemoryStep({name, markers, artifacts, outputText, sinceMs})` | Evidence check |
| `writeLog({cadence, agent, status, ...})` | Writes YAML-frontmatter task log file |
| `exitWithSummary(code, data)` | Prints summary + calls process.exit |

## Key invariants

1. **lock:complete gate**: `npm run lock:complete` is called only after memory
   verification (step 14), artifact verification (step 15), and all validation
   commands (step 16) pass. If any gate fails, the run ends without publishing
   completion.

2. **Completed log gate**: `_completed.md` task log is written only after
   lock:complete exits 0 (step 17). Earlier failures always write `_failed.md`
   or `_deferred.md`.

3. **Race resolution**: Lock exit code 3 (race lost) causes the scheduler to
   restart the loop at step 4, re-checking what agents are available. This is
   the normal race resolution path — not an error.

4. **Time-window guard**: Agents that appear in a recent local log (within 24h
   for daily, 7d for weekly) are added to the exclusion set regardless of relay
   state. This handles the cross-midnight edge case where the relay date-scope
   has rolled over.

5. **Cycle saturation**: When all roster agents are in the time-window exclusion
   set, the scheduler exits 0 with a "cycle complete" reason — not treated as
   an error by cron/CI.

6. **Deferral state is day-scoped**: `task-logs/<cadence>/.scheduler-run-state.json`
   is reset whenever `run_date` changes, so deferral budgets do not carry across days.

## Edge cases & error paths

| Scenario | Behavior |
|----------|----------|
| No roster entries | `process.exit(1)` before loop |
| Roster fully excluded (not cycle-saturated) | `_failed.md` + exit 1 |
| All relays unhealthy (preflight) | `_deferred.md` + exit 0 |
| Lock backend error (strict mode) | `_failed.md` + exit 2 |
| Lock backend error (non-strict, within window/budget) | `_deferred.md` + exit 0; deferral state persisted |
| Lock backend error (non-strict, budget exhausted) | `_failed.md` + exit 2 |
| Prompt file missing or unreadable | `_failed.md (prompt_parse_error)` + exit 1 |
| Prompt first line not `#` or `>` | `_failed.md (prompt_schema_error)` + exit 1 |
| handoffCommand missing (non-interactive mode) | `_failed.md (execution_error)` + exit 1 |
| handoffCommand exits non-zero | `_failed.md (execution_error)` + exit non-zero |
| Memory evidence missing (required mode) | `_failed.md (prompt_schema_error)` + exit 1 |
| Memory evidence missing (optional mode) | console.warn, continue |
| Artifact verification fails | `_failed.md (prompt_schema_error)` + exit non-zero |
| Validation command exits non-zero | `_failed.md (execution_error)` + exit non-zero |
| lock:complete exits non-zero | `_failed.md` + exit non-zero |

## Security considerations

- ⚠️ Environment variables injected into child processes (`SCHEDULER_AGENT`,
  `SCHEDULER_CADENCE`, `SCHEDULER_PROMPT_PATH`, `SCHEDULER_MEMORY_FILE`) are derived
  from the roster and config — not from user input. No sanitization issue here, but
  ensure `torch-config.json` is not writable by untrusted parties.
- The handoff command is executed via `bash -lc` with a login shell. The command
  string comes from `torch-config.json`. Do not allow untrusted config sources.
- No cryptographic or signing logic in this file.

## Performance & concurrency

- The loop is single-threaded and sequential; no parallel lock attempts.
- Each iteration makes several network calls (lock:check, lock:lock, lock:complete)
  that may take seconds each. Total wall-clock time per cycle depends heavily on
  relay latency and handoff command duration.
- `getLatestFile()` reads all log filenames and file contents synchronously in
  memory — acceptable for typical log counts (< 1000 files) but worth monitoring
  if logs accumulate without rotation.

## Related files and call graph

| File | Relationship |
|------|-------------|
| `scripts/agent/scheduler-utils.mjs` | Utility functions (runCommand, readJson, parsers, etc.) |
| `scripts/agent/scheduler-lock.mjs` | Lock acquisition, error classification, preflight |
| `scripts/agent/verify-run-artifacts.mjs` | Run artifact validation (called as subprocess) |
| `scripts/agent/scheduler-utils.mjs:buildRecentlyRunExclusionSet` | Time-window guard |
| `src/utils.mjs:detectPlatform` | Auto-detects agent platform |
| `src/prompts/roster.json` | Agent roster (read at startup) |
| `src/prompts/scheduler-flow.md` | Authoritative numbered steps (implemented by this script) |
| `torch-config.json` | Handoff command, memory policy, lock policy |
| `task-logs/<cadence>/` | Task logs written and read here |
| `task-logs/<cadence>/.scheduler-run-state.json` | Deferral state (day-scoped) |
| `memory-updates/` | Memory update files (written path injected as env var) |

## Why it works this way

- **Infinite loop with restart on race loss**: Distributed lock systems inherently
  have races; the loop lets the scheduler immediately try the next available agent
  without requiring the caller to re-invoke the script.
- **Day-scoped run-state**: Deferral tracking needs to persist across multiple rapid
  scheduler invocations on the same day (e.g., cron every 5 minutes) but should
  reset daily so a failed relay doesn't block the next day's run.
- **lock:complete gated behind all validation**: Ensures a completion event on the
  relay (which prevents future agents from re-running the same slot) is only
  published after the run is genuinely finished and verified. This prevents
  "green-but-worthless" completions.
- **Subprocess model for handoff**: Agents run in their own process with
  environment variables injected by the scheduler. This isolates agent crashes
  and allows the scheduler to check exit codes cleanly.

## When to change

- **New validation gate**: Add a step between artifact check and lock:complete.
  Maintain the gate ordering: memory evidence → artifact check → validation → lock:complete.
- **New failure category**: Add to the `FAILURE_CATEGORY` constant and document
  in `src/prompts/scheduler-flow.md`.
- **New config option**: Add parsing in `getSchedulerConfig()` with an env var
  override following the existing pattern.
- **Log format change**: Update `writeLog()` — also update `verify-run-artifacts.mjs`
  and `scheduler-utils.mjs:parseFrontmatterAgent` to match.

## Tests that validate behavior

- `test/run-scheduler-cycle-memory-policy.test.mjs` — memory policy enforcement
- `test/scheduler-time-window.test.mjs` — time-window guard behavior
- `test/scheduler-preflight-lock.e2e.test.mjs` — preflight + lock flow

```bash
# Run all scheduler tests:
node --test test/run-scheduler-cycle-memory-policy.test.mjs test/scheduler-time-window.test.mjs
# Or full suite (may be slow in sandbox):
npm test
```
