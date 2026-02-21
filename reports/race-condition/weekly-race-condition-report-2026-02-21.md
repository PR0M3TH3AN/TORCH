# Weekly Race Condition Report - 2026-02-21

## Focus Area
**Background services and workers**, specifically:
- `src/relay-health.mjs` (Relay health probing)
- `src/lock-publisher.mjs` (Lock publication orchestration)
- `src/services/memory/scheduler.js` (Memory job scheduling)

## Findings

### 1. Resource Leak in Relay Health Probes (Critical)
**File:** `src/relay-health.mjs`
**Description:** The `probeWebSocketReachability` and `probePublishRead` functions wrapped a `new Promise` (containing WebSocket logic) with `withTimeout`. However, the WebSocket instance was created inside the promise executor, and there was no mechanism to close it if the `withTimeout` race was won by the timeout.
**Impact:** If a relay connection hung, `withTimeout` would throw, but the underlying WebSocket connection attempt would continue in the background. This leads to a leak of WebSocket connections and file descriptors, which is critical for a long-running scheduler.
**Likelihood:** High (network timeouts are common).

### 2. Unhandled Promise Rejection in Lock Publisher (High)
**File:** `src/lock-publisher.mjs`
**Description:** `publishToRelays` uses `Promise.allSettled` on an array of promises wrapped with `withTimeout`. If `withTimeout` rejects (due to timeout), the original `publishPromise` (from `nostr-tools`) continues running. If that original promise subsequently rejects (e.g., network error), that rejection is unhandled because the parent promise (`Promise.allSettled`'s element) has already settled.
**Impact:** Unhandled promise rejections can crash the Node.js process or cause instability.
**Likelihood:** Medium (requires a publish to fail *after* the timeout duration).

### 3. Potential Scheduler Overlap (Low/Acceptable)
**File:** `src/services/memory/scheduler.js`
**Description:** `startFixedIntervalJob` uses `setInterval` without waiting for the previous job to complete. This allows overlap if a job takes longer than its interval.
**Assessment:** The jobs using this pattern (`consolidateObservations`, `pruningCycle`) have very long intervals (1 hour, 1 day) and use locking (`lockProvider`). The lock provider correctly prevents concurrent execution (either by skipping or waiting). This behavior is deemed acceptable for now.

## Fixes Implemented

### Fix 1: WebSocket Cleanup
Modified `src/relay-health.mjs` to ensure the WebSocket is closed if the probe times out.
- **Approach:** Wrapped the probe logic in a `try...catch` block. If `withTimeout` throws (timeout), the `catch` block explicitly calls `ws.close()` if `ws` exists.

### Fix 2: Suppress Unhandled Rejections
Modified `src/lock-publisher.mjs` to attach a no-op `.catch()` handler to the inner publish promises.
- **Approach:** `publishPromise.catch(() => {})` ensures that any late rejection is strictly handled, preventing process crashes, while `withTimeout` still governs the control flow.

## Verification
- **Static Analysis:** Verified that the new code paths correctly handle the timeout/error scenarios.
- **Lint:** `npm run lint` will be run to ensure no syntax errors.

## Next Steps
- Monitor relay health logs to ensure no degradation in probe reliability.
- Consider `AbortSignal` integration if `nostr-tools` updates to support it for cleaner cancellation.
