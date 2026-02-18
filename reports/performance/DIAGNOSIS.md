# Diagnosis: 15s Execution Floor in Lock Queries

## Observation
The command `torch-lock list` and other lock operations consistently take slightly over 15 seconds to complete, even when network conditions are good and relays respond quickly (within <1s).

## Root Cause Analysis
The `queryLocks` function in `src/lock-ops.mjs` uses `Promise.race` to enforce a timeout (default 15s) on relay queries.

```javascript
    const events = await Promise.race([
      pool.querySync(relays, { ... }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Relay query timed out')), queryTimeoutMs),
      ),
    ]);
```

When `pool.querySync` completes successfully (e.g., in 600ms), the `Promise.race` resolves immediately. However, the `setTimeout` created in the second promise remains active in the Node.js event loop. Node.js processes do not exit as long as there are active handles (like timers). Thus, the process waits for the remaining ~14.4s until the timer fires (and the callback is executed, though ignored) before exiting.

## Verification
A reproduction script confirmed that `Promise.race` with an uncleared `setTimeout` prevents process exit until the timeout fires.

## Proposed Fix
Capture the `timeoutHandle` from `setTimeout` and explicitly clear it using `clearTimeout(timeoutHandle)` in the `finally` block of the `queryLocks` function.
