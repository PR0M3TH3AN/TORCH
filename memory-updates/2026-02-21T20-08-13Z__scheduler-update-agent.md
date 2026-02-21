# Memory Update - scheduler-update-agent - 2026-02-21

## Key findings
- Scheduler reliability improves when handoff failures are classified and retried only for retryable network signatures.
- `lock:check --json --quiet` still needs defensive parsing; consume structured JSON events and choose the payload with exclusion keys.

## Patterns / reusable knowledge
- For spawned-agent handoff, use bounded retries with backoff plus optional fallback platform as a last resort.
- For runner availability, run a preflight command before lock acquisition to avoid claiming work that cannot execute.

## Warnings / gotchas
- `cmdCheck` should suppress query health/error loggers in quiet JSON mode to keep automation parsing deterministic.
- Memory evidence is easier to validate when latest cadence artifacts include both marker and JSON (`retrieve/store.ok` + `retrieve/store.json`).
