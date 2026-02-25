# Protocol Inventory

This file tracks external protocol specifications and libraries used in this repository, their implementation points, and compliance status.

## Nostr (NIPs)

| Protocol / Spec | Implementation Points | Compliance Status | Notes |
| :--- | :--- | :--- | :--- |
| **NIP-01** (Basic Protocol) | `src/lib.mjs`, `src/lock-ops.mjs`, `src/relay-health.mjs` | Compliant | Uses `nostr-tools` for event creation, signing, and relay communication. |
| **NIP-04** (Encrypted Direct Message) | N/A | Not Implemented | No usage found in codebase. |
| **NIP-33** (Parameterized Replaceable Events) | `src/lock-ops.mjs` | Compliant | Defines the mechanics for Kind 30078 updates (d-tags). |
| **NIP-40** (Expiration Timestamp) | `src/lock-ops.mjs` | Compliant | Parses `expiration` tag to filter active locks. |
| **NIP-42** (Authentication) | N/A | Not Implemented | No usage found in codebase. |
| **NIP-78** (Application-specific Data) | `src/lock-ops.mjs` | Compliant | Uses Kind 30078 for distributed lock state. |

## Other Protocols

| Protocol | Implementation Points | Compliance Status | Notes |
| :--- | :--- | :--- | :--- |
| **HTTP/1.1** | `src/dashboard.mjs`, `dashboard/` | Compliant | Dashboard server uses Node.js `http` module. |
| **WebSocket** | `src/relay-health.mjs` | Compliant | Raw `ws` usage for health probes; `nostr-tools` for standard relay comms. |
| **JSON** | `src/lock-ops.mjs`, `src/ops.mjs` | Compliant | Ubiquitous for event content and config files. |

## Internal / Custom Protocols

| Name | Kind / ID | Implementation | Notes |
| :--- | :--- | :--- | :--- |
| **Relay Health Probe** | Kind `27235` | `src/relay-health.mjs` | Custom ephemeral event kind used for deep reachability checks. |

## Libraries

| Library | Version | Usage | Risks |
| :--- | :--- | :--- | :--- |
| `nostr-tools` | `2.23.1` | Core Nostr primitives (keys, events, pool). | Supply chain risk. Pinned version recommended. |
| `ws` | `8.19.0` | WebSocket client for Node.js. | Standard library for Node.js websocket support. |

## Implementation details

- **Locking Mechanism**: Uses Kind 30078 (NIP-78) with NIP-33 semantics (d-tags) and NIP-40 expiration.
- **Relay Communication**: Uses `SimplePool` from `nostr-tools` for querying and publishing.
- **Health Checks**: Uses raw `WebSocket` connections in `src/relay-health.mjs` for deep health probes (Kind 27235).
