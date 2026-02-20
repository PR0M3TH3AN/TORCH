# src/lib.mjs: Core Logic Overview

## Summary
`src/lib.mjs` is the orchestration engine for Torch. It implements the high-level commands (`check`, `lock`, `list`, `complete`) that coordinate between local configuration, the file system (task logs), and Nostr relays (distributed locks).

It is designed to be:
- **Stateless**: No persistent local database; relies on Nostr events and flat files.
- **Race-Condition Safe**: Uses a commit-wait-reveal pattern to handle concurrent agent starts.
- **Dependency Injected**: Nearly all external side-effects (relays, time, FS) can be mocked.

## Public API

### `cmdCheck(cadence, deps)`
Aggregates the current state of the world for a given cadence.
- **Inputs**: Cadence ('daily'/'weekly').
- **Outputs**: JSON object with lists of `locked`, `completed`, `paused`, and `available` agents.
- **Side Effects**: Queries relays, reads `task-logs/`, reads `torch-config.json`.

### `cmdLock(agent, cadence, dryRun, deps)`
Attempts to claim a task.
- **Returns**: `{ status: 'ok', eventId: '...' }`
- **Throws**: `ExitError(3)` if the lock is denied (already active, completed, or race lost).

### `cmdComplete(agent, cadence, dryRun, deps)`
Finalizes a task.
- **Action**: Publishes a permanent event (no expiration) with `status: 'completed'`.
- **Constraint**: Requires an existing active lock for the agent.

### `cmdList(cadence, deps)`
Displays a CLI-friendly table of active locks.

## Locking Flow (Sequence)

1. **Check**: Query relays for any existing valid lock for `(agent, cadence, date)`.
   - If found and `status=completed`: **Abort** (Task done).
   - If found and `status=started` (and not expired): **Abort** (Agent busy).
2. **Generate**: Create a new ephemeral Nostr keypair.
3. **Build**: Create a signed event (Kind 30078) with:
   - Tags: `d` (identifier), `expiration`, `t` (search tags).
   - Content: JSON payload with metadata.
4. **Publish**: Send to all configured relays.
5. **Race Check**:
   - Wait `RACE_CHECK_DELAY_MS` (default 1500ms).
   - Query relays again.
   - If another valid event exists with an *earlier* `created_at`: **Abort** (Race lost).
   - Otherwise: **Success**.

## Key Invariants

- **Uniqueness**: Only one valid lock per (agent, cadence, date) should exist at a time.
- **Expiration**: All locks must have an `expiration` tag (NIP-40) to prevent zombies, except completion events.
- **Completion**: A completion event is permanent (no expiration) and effectively "freezes" the slot for that date.

## When to Change

- **Protocol Upgrades**: If changing the Nostr event structure or tags.
- **Concurrency Tuning**: Adjusting `RACE_CHECK_DELAY_MS` or retry logic.
- **New Commands**: Adding new lifecycle states (e.g., `failed` or `paused` via CLI).
