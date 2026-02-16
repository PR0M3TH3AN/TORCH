# KNOWN_ISSUES.md

Track only **active, reproducible, unresolved** issues.

## Entry template

### [Issue title]
- **Status:** Open | Monitoring | Mitigated
- **Area:** Build | Test | Tooling | Runtime | Docs | Other
- **Symptom:**
- **Trigger/Conditions:**
- **Workaround:**
- **Impact:**
- **Related notes:** `docs/agent-handoffs/incidents/...` (optional)
- **Last verified:** YYYY-MM-DD

## Active issues

### Goose Desktop: hermit "text file busy" (ETXTBSY) blocks all `node`/`npm` commands
- **Status:** Active (local workaround applied, upstream fix needed)
- **Area:** Tooling
- **Symptom:** Every `node`/`npm` command fails with `fatal:hermit: open /home/user/.config/goose/mcp-hermit/bin/hermit: text file busy`. All Torch lock/scheduler commands are blocked.
- **Trigger/Conditions:** Any Goose Desktop on Linux. The Goose `node` wrapper downloads hermit, then runs `hermit init` which tries to overwrite its own running binary — Linux returns ETXTBSY.
- **Workaround:** Use patched setup: `PATH=/home/user/.local/goose-fix/bin:$PATH` before commands. Or: `rm -rf ~/.config/goose/mcp-hermit` then use patched wrappers. See `docs/agent-handoffs/incidents/2026-02-15-hermit-text-file-busy.md` for the full patch.
- **Impact:** Critical — 100% blocks scheduler runs, lock operations, and any npm script on Goose Desktop.
- **Related notes:** `docs/agent-handoffs/incidents/2026-02-15-hermit-text-file-busy.md`, patch at `docs/agent-handoffs/incidents/goose-hermit-etxtbsy-fix.patch`
- **Last verified:** 2026-02-15

### Goose Desktop: `node`/`npx` wrappers swallow non-zero exit codes
- **Status:** Active (no workaround except stdout parsing)
- **Area:** Tooling
- **Symptom:** The Goose `node` wrapper uses `node "$@" || log "Failed"` which catches non-zero exits and returns 0. Torch `lock:lock` exit 3 (lock denied) appears as exit 0.
- **Trigger/Conditions:** Any Goose Desktop shell command that relies on `node` exit codes.
- **Workaround:** Parse stdout for `LOCK_STATUS=denied` / `LOCK_STATUS=race_lost` instead of relying on exit codes.
- **Impact:** Medium — scheduler lock-race retry logic broken; requires stdout parsing fallback.
- **Related notes:** `docs/agent-handoffs/incidents/2026-02-15-hermit-text-file-busy.md`
- **Last verified:** 2026-02-15

### `npm test` fails due to prompt contract violations
- **Status:** Active
- **Area:** Tooling
- **Symptom:** `npm test` fails with multiple `[prompt-contract]` errors for missing `lock:complete` tokens in daily/weekly agent prompts.
- **Trigger/Conditions:** Running `npm test`.
- **Workaround:** Run `npm run validate:scheduler` separately and inspect output, or ignore errors for now.
- **Impact:** CI/local testing blocked.
- **Last verified:** 2026-02-14

### `npm test` hangs/times out in full suite run
- **Status:** Active
- **Area:** Test
- **Symptom:** `npm test` times out after 400s when running all tests together.
- **Trigger/Conditions:** Running `npm test` in CI/Sandbox.
- **Workaround:** Run individual test files or subsets (`npm run validate:scheduler`, `npm run test:integration:e2e`, then specific unit tests).
- **Impact:** Cannot verify all tests in a single pass.
- **Related notes:** `docs/agent-handoffs/incidents/2026-02-16-npm-test-timeout.md`
- **Last verified:** 2026-02-16

### Recurring scheduler lock backend failures in recent task logs
- **Status:** Monitoring
- **Area:** Runtime
- **Symptom:** Multiple scheduler runs fail with `Lock backend error` before prompt handoff/validation.
- **Trigger/Conditions:** Running scheduler cycles when relay connectivity is unstable or lock backend operations time out; observed in both `daily` and `weekly` task logs.
- **Workaround:** Run relay preflight (`npm run lock:health -- --cadence <daily|weekly>`) and inspect `task-logs/relay-health/<cadence>.jsonl` for trend/alert data before rerunning scheduler. If scheduler logs `All relays unhealthy preflight`, treat it as an incident signal, defer lock attempts, and escalate relay/network checks (DNS/TLS/connectivity).
- **Impact:** Scheduled agent execution may be deferred early when all relays are unhealthy, preventing noisy lock retries until relay health recovers.
- **Related notes:** `docs/agent-handoffs/learnings/2026-02-15-relay-health-preflight-job.md`
- **Last verified:** 2026-02-15

