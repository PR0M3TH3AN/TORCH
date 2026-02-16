# `src/lock-ops.mjs` Overview

This module implements the core logic for distributed locking using Nostr relays. It handles querying for existing locks, publishing new lock events, and managing relay health and fallbacks.

## High-Level Summary
The `lock-ops` module provides the mechanism for agents to coordinate and avoid race conditions. It uses ephemeral Nostr events (Kind `30078` parameterized replaceable events, though currently using `app_data`) to represent locks. It includes robust retry logic, relay health scoring, and fallback mechanisms to ensure reliability even when some relays are slow or offline.

## Public Surface

### `queryLocks(relays, cadence, dateStr, namespace, deps)`
Queries the specified relays for active locks matching the cadence and date.
- **relays**: Array of relay URLs.
- **cadence**: 'daily' or 'weekly'.
- **dateStr**: Date string (YYYY-MM-DD).
- **namespace**: Application namespace (e.g., 'torch').
- **Returns**: Array of active lock objects.

### `publishLock(relays, event, deps)`
Publishes a lock event to the specified relays, ensuring a quorum is met.
- **relays**: Array of relay URLs.
- **event**: The Nostr event object to publish.
- **Returns**: The published event if successful, throws error otherwise.

### `parseLockEvent(event)`
Parses a raw Nostr event into a structured lock object.
- **event**: Raw Nostr event.
- **Returns**: Structured lock object with `agent`, `cadence`, `expiresAt`, etc.

## Key Flows

1. **Lock Acquisition**:
   - `queryLocks` is called to check for existing locks.
   - If no valid lock exists, a new lock event is created (external to this module).
   - `publishLock` is called to broadcast the event.
   - Race check (reading back) confirms ownership (handled by caller, `src/lib.mjs`).

2. **Relay Health & Fallback**:
   - Relays are scored based on latency and success rate.
   - Failed attempts penalize the relay score.
   - If primary relays fail, fallback relays are used.

## Invariants
- Locks must have an expiration time.
- A lock is only valid if it is the latest event for the `d` tag.
- Publishing requires a minimum number of successful relays (quorum).

## When to Change
- If the relay selection or scoring algorithm needs tuning.
- If the underlying Nostr event structure changes.
- If new telemetry or logging requirements arise.
