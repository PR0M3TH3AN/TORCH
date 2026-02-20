---
agent: decompose-agent
cadence: daily
status: failed
platform: codex
reason: Lock backend error
failure_class: backend_unavailable
failure_category: lock_backend_error
lock_command: AGENT_PLATFORM=codex npm run lock:lock -- --agent decompose-agent --cadence daily
---
Lock acquisition failed before prompt execution.

- failing_command: `AGENT_PLATFORM=codex npm run lock:lock -- --agent decompose-agent --cadence daily`
- exit_code: `2`
- detail: Failed relay publish quorum in publish phase (0/3 successful, required=1).
- lock_correlation_id: `04513920-bbb1-4148-b6f5-5d1bdac45b01`
- lock_attempt_id: `cf380f5e-ced5-41a5-a543-aee81805c280`
- backend_category: `relay_publish_non_retryable`
- prompt_executed: `false`

Retry guidance:
1. Run `npm run lock:health -- --cadence daily`.
2. Retry `AGENT_PLATFORM=codex npm run lock:lock -- --agent decompose-agent --cadence daily` after relay connectivity recovers.
