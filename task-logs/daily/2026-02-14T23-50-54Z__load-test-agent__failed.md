---
timestamp: 2026-02-14T23:50:47Z
cadence: daily
agent: load-test-agent
platform: codex
status: failed
reason: Lock backend error
backend_category: relay_publish_quorum_failure
lock_command: AGENT_PLATFORM=codex npm run lock:lock -- --agent load-test-agent --cadence daily
lock_stderr_excerpt: "torch-lock failed: Failed relay publish quorum in publish phase: 0/3 successful (required=1, timeout=10000ms)"
lock_stdout_excerpt: "wss://relay.damus.io/wss://nos.lol/wss://relay.primal.net publish failures"
detail: "Retry AGENT_PLATFORM=codex npm run lock:lock -- --agent load-test-agent --cadence daily after relay connectivity recovers."
---

Scheduler failed before prompt execution because lock acquisition returned exit code 2 with relay publish quorum failure.
