# Weekly Race Condition Report: 2026-02-15

## Focus Areas Audited
- Shared Client and Relay Pool (`src/lib.mjs`, `src/lock-ops.mjs`)

## Findings

### 1. Non-deterministic Lock Sorting in `cmdLock` (High Severity)
- **Description**: The `cmdLock` function in `src/lib.mjs` sorts contending lock events by `createdAt` timestamp only. Since Nostr `created_at` has 1-second resolution, two agents creating lock events in the same second could be sorted differently by different clients depending on the order in which relays return them (or local array sort stability if not handled).
- **Interleaving**:
  1. Agent A creates lock event E1 at T=100.
  2. Agent B creates lock event E2 at T=100.
  3. Agent A queries relays, receives [E1, E2]. Sorts by time (equal). If stable sort or random order puts E1 first, A thinks it won.
  4. Agent B queries relays, receives [E2, E1]. Sorts by time (equal). If stable sort or random order puts E2 first, B thinks it won.
  5. Both agents proceed to execute the task, violating the mutual exclusion property.
- **Fix**: Implemented a deterministic tie-breaker using `eventId` (lexicographical comparison).
  ```javascript
  .sort((a, b) => (a.createdAt - b.createdAt) || String(a.eventId).localeCompare(String(b.eventId)));
  ```
- **Risk**: Low (behavior preserving, standard distributed system practice).

## Next Week Focus
- App initialization and login flow.
