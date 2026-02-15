# Protocol Inventory

This file tracks external protocol specifications and libraries used in this repository, their implementation points, and compliance status.

## Nostr (NIPs)

| Protocol / Spec | Implementation Points | Compliance Status | Notes |
| :--- | :--- | :--- | :--- |
| **NIP-01** (Basic Protocol) | `src/lib.mjs`, `src/lock-ops.mjs` | Compliant | Uses `nostr-tools` for event creation, signing, and relay communication. |
| **NIP-04** (Encrypted Direct Message) | N/A | Unknown | Not explicitly used in lock logic, but mentioned in test prompts. |
| **NIP-42** (Authentication) | N/A | Unknown | Not currently implemented in lock logic. |
| **NIP-33** (Parameterized Replaceable Events) | `src/lock-ops.mjs` | Compliant | Used for lock events (Kind 30078 is used, which is Application Specific Data, functionally similar to replaceable events). |

## Libraries

| Library | Version | Usage | Risks |
| :--- | :--- | :--- | :--- |
| `nostr-tools` | `2.19.4` | Core Nostr primitives (keys, events, pool). | Supply chain risk. pinned version recommended. |
| `ws` | `8.19.0` | WebSocket client for Node.js. | standard library for Node.js websocket support. |

## Implementation details

- **Locking Mechanism**: Uses Kind 30078 (Application Specific Data) for lock events.
- **Relay Communication**: Uses `SimplePool` from `nostr-tools` for querying and publishing.
- **Health Checks**: Uses raw `WebSocket` connections in `src/relay-health.mjs` for deep health probes.
