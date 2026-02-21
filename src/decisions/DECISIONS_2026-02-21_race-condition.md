# Decisions - 2026-02-21 Race Condition Agent

## Decision: Explicit WebSocket Closure on Timeout

**Context:** The existing `probeWebSocketReachability` function in `src/relay-health.mjs` leaked connections when timeouts occurred.
**Decision:** We chose to extract the WebSocket connection management logic so that we can catch timeout exceptions from `withTimeout` and explicitly close the socket.
**Alternatives Considered:** Relying on `ws.close()` inside the promise executor (which is unreachable after timeout).
**Rationale:** Explicit closure is the only reliable way to prevent file descriptor leaks in this scenario.

## Decision: Suppress Unhandled Rejections via `.catch()`

**Context:** `src/lock-publisher.mjs` had potential for unhandled promise rejections if `publishPromise` failed after `withTimeout` settled.
**Decision:** Attached a no-op `.catch(() => {})` handler to `publishPromise`.
**Rationale:** This prevents the runtime from flagging unhandled rejections, while preserving the existing logic flow.
