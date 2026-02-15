# Relay health preflight job before scheduler lock acquisition

## Context
- Scheduler runs were intermittently failing during lock acquisition when relay connectivity degraded.
- Existing preflight checks only validated lock query behavior and did not preserve health history for trend analysis.

## Observation
- A dedicated relay probe that checks websocket reachability plus publish/read behavior per relay provides a clearer readiness signal before lock acquisition.
- Persisting each probe result enables windowed success-rate alerts and detection of prolonged all-relay outages.

## Action taken
- Added `torch-lock health` / `npm run lock:health` to run relay websocket + publish/read probes per relay.
- Integrated scheduler preflight to call `lock:health` immediately before lock acquisition.
- Updated scheduler behavior to defer early (status `_deferred`) with reason `All relays unhealthy preflight` and incident metadata when no relay is healthy.
- Stored probe history in `task-logs/relay-health/<cadence>.jsonl` and evaluated alert thresholds:
  - all relays down for more than N minutes,
  - success rate below X% over a rolling time window.

## Validation performed
- Ran targeted unit tests for relay health threshold evaluation.
- Ran scheduler flow parity checks to ensure preflight remains before lock acquisition in required ordering.

## Recommendation for next agents
- Keep `lock:health` enabled for scheduler preflight in automation.
- Review `task-logs/relay-health/<cadence>.jsonl` during incidents to distinguish transient single-relay flakiness from full relay outages.
- Tune threshold defaults (`--all-relays-down-minutes`, `--min-success-rate`, `--window-minutes`) per environment reliability goals.
