# Race Condition TODOs - 2026-02-21

## Completed

- [x] Fix WebSocket leak in `probeWebSocketReachability` (src/relay-health.mjs)
- [x] Fix WebSocket leak in `probePublishRead` (src/relay-health.mjs)
- [x] Suppress unhandled promise rejection in `publishToRelays` (src/lock-publisher.mjs)

## Pending

- [ ] Investigate if `nostr-tools` supports `AbortSignal` for cleaner cancellation in future updates.
- [ ] Monitor long-running processes for file descriptor counts (potential additional leaks).
