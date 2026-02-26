# Lock Operations (`src/lock-ops.mjs`) Overview

This module implements the core distributed locking mechanism for the Torch agent system using the Nostr protocol. It ensures that agents operating on different machines or environments can coordinate their activities without race conditions.

## Architecture

The module is built around two main components:

1.  **`RelayHealthManager`**: A singleton (accessible via `defaultHealthManager`) that tracks the health of Nostr relays. It records success/failure outcomes, latency, and timeouts. It uses this data to score and rank relays, ensuring that operations prioritize healthy relays and quarantine failing ones.
2.  **`LockPublisher`**: A class that orchestrates the publication of lock events. It uses the `RelayHealthManager` to select the best relays and implements a robust retry mechanism with exponential backoff.

## Key Flows

### 1. Acquiring a Lock (`publishLock`)

The process of acquiring a lock involves publishing a specific Nostr event (Kind 30078 with a `d` tag) to a quorum of relays.

1.  **Initialization**: `publishLock` initializes a `LockPublisher` with the target relays and the lock event.
2.  **Primary Phase**: The publisher attempts to send the event to the configured *primary relays*.
    - Relays are prioritized by health score.
3.  **Fallback Phase** (if needed): If the number of successful publishes is below the required quorum (`minSuccesses`), the publisher attempts *fallback relays*.
4.  **Retry Loop**:
    - If quorum is still not met, the system analyzes the failures.
    - If failures are *transient* (e.g., timeout, network error) and the retry budget permits, the system waits (exponential backoff) and retries the process.
    - If failures are *permanent* (e.g., auth error) or the retry budget is exhausted, the operation fails.
5.  **Completion**: Returns the event on success or throws an error on failure.

### 2. Checking Locks (`queryLocks`)

Before claiming a task, agents query for existing locks.

1.  **Prioritization**: The function asks `RelayHealthManager` to rank the provided relays.
2.  **Query**: It sends a request for active lock events to the top-ranked relays.
3.  **Fallback**: If the query fails (e.g., all primary relays time out), it automatically retries with fallback relays.
4.  **Filtering**: Results are filtered to exclude expired locks.

## Public API

### `publishLock(relays, event, deps)`
Publishes a lock event to the network.
- **relays**: Array of relay URLs.
- **event**: The Nostr event object.
- **deps**: Dependencies (config, logger, etc.).

### `queryLocks(relays, cadence, dateStr, namespace, deps)`
Finds active locks for a specific scope.
- **cadence**: 'daily' | 'weekly'.
- **dateStr**: 'YYYY-MM-DD'.

### `parseLockEvent(event)`
Utility to parse a raw Nostr event into a structured lock object, handling JSON parsing of content and tag extraction.

## Failure Handling

- **Transient Errors**: Network timeouts, connection resets, 503s. These trigger retries.
- **Permanent Errors**: TLS errors, protocol violations. These abort the retry loop immediately.
- **Quarantine**: Relays that fail repeatedly are temporarily "quarantined" (ignored) by the `RelayHealthManager` to prevent slowing down operations, but are slowly reintroduced to check for recovery.
