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
- **Status:** Resolved
- **Area:** Tooling
- **Symptom:** `npm test` fails with multiple `[prompt-contract]` errors for missing `lock:complete` tokens in daily/weekly agent prompts.
- **Trigger/Conditions:** Running `npm test`.
- **Workaround:** Run `npm run validate:scheduler` separately and inspect output, or ignore errors for now.
- **Impact:** CI/local testing blocked.
- **Last verified:** 2026-02-18

### `npm test` hangs/times out in full suite run
- **Status:** Resolved
- **Area:** Test
- **Symptom:** `npm test` times out after 400s when running all tests together.
- **Trigger/Conditions:** Running `npm test` in CI/Sandbox.
- **Fix:** Fixed blocking \`spawnSync\` in \`nostr-lock.test.mjs\`, removed real network calls in smoke tests, and switched dashboard tests to dynamic ports.
- **Impact:** Test suite duration reduced from 400s+ to <10s.
- **Last verified:** 2026-02-19

### Recurring scheduler lock backend failures in recent task logs
- **Status:** Monitoring
- **Area:** Runtime
- **Symptom:** Multiple scheduler runs fail with `Lock backend error` before prompt handoff/validation.
- **Trigger/Conditions:** Running scheduler cycles when relay connectivity is unstable or lock backend operations time out; observed in both `daily` and `weekly` task logs.
- **Workaround:** Run relay preflight (`npm run lock:health -- --cadence <daily|weekly>`) and inspect `task-logs/relay-health/<cadence>.jsonl` for trend/alert data before rerunning scheduler. If scheduler logs `All relays unhealthy preflight`, treat it as an incident signal, defer lock attempts, and escalate relay/network checks (DNS/TLS/connectivity).
- **Impact:** Scheduled agent execution may be deferred early when all relays are unhealthy, preventing noisy lock retries until relay health recovers.
- **Related notes:** `docs/agent-handoffs/learnings/2026-02-15-relay-health-preflight-job.md`
- **Last verified:** 2026-02-15

### Claude Code: outbound WebSocket blocked — scheduler cannot run from this environment
- **Status:** Active (no code-level workaround)
- **Area:** Runtime / Tooling
- **Symptom:** `torch-lock` commands (`lock:check`, `lock:lock`, `lock:complete`) fail to connect to any Nostr relay. The underlying error is a WebSocket handshake rejection at the proxy layer. In Node.js the symptom is `getaddrinfo ENOTFOUND` (empty `/etc/resolv.conf`) or a connection hang/timeout for `wss://` URLs.
- **Trigger/Conditions:** Any `torch-lock` or scheduler command run from inside the Claude Code remote sandbox. The proxy intercepts all egress traffic; it supports HTTP/HTTPS `CONNECT` tunneling but strips the `Upgrade: websocket` header at L7, so the WebSocket handshake never completes. This affects all outbound WebSocket connections, not just Nostr relays (confirmed by multiple open GitHub issues: anthropics/claude-code #490, #2059, #17333).
- **Workaround (attempted and rejected):** A local relay on `ws://127.0.0.1:PORT` is reachable (bypasses both DNS and the proxy), but **breaks cross-agent coordination**: other agents (Jules/Google Cloud) publish locks to the public Nostr relays (`wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.primal.net`). A local relay is invisible to those agents, causing double-claiming of scheduled agent slots.
- **Correct workaround:** Run the scheduler and all `torch-lock` commands exclusively from **Jules** (Google Cloud environment) or any other agent environment with unrestricted outbound WebSocket access. Do not attempt to run `lock:lock` / `lock:complete` from Claude Code sessions.
- **Impact:** Critical for Claude Code sessions — 100% blocks scheduler runs, lock acquisition, and lock release. No impact on Jules-initiated runs.
- **Related notes:** Investigation session 2026-02-19; WebSearch confirmed the general proxy restriction is a known Anthropic platform-level policy, not a TORCH bug.
- **Last verified:** 2026-02-19

### content-audit-agent targets missing /content directory
- **Status:** Resolved
- **Area:** Docs
- **Symptom:** `content-audit-agent` fails to find `/content` directory.
- **Trigger/Conditions:** Running `content-audit-agent`.
- **Workaround:** None. Prompt updated to target `docs/` instead of `/content`.
- **Impact:** Docs audit cannot be performed.
- **Last verified:** 2026-02-18

### content-audit-agent mission remains mis-scoped (no upload/contribution product surface in repo)
- **Status:** Active
- **Area:** Docs
- **Symptom:** `content-audit-agent` is instructed to audit upload/contribution media flows (MIME limits, resumability, moderation, attribution), but repository docs and code contain no such features or contracts.
- **Trigger/Conditions:** Running `content-audit-agent` against current default branch.
- **Workaround:** Execute a no-op audit with evidence capture, then report scope mismatch instead of fabricating doc updates.
- **Impact:** Repeated no-op runs and prompt/mission drift; no actionable docs-runtime alignment can be performed for upload workflows.
- **Related notes:** `docs/agent-handoffs/incidents/2026-02-20-content-audit-no-upload-surface.md`
- **Last verified:** 2026-02-20
