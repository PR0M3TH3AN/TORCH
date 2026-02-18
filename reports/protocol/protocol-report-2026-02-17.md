# Protocol Compliance Report - 2026-02-17

**Agent:** protocol-research-agent
**Date:** 2026-02-17

## Executive Summary
The repository maintains strong compliance with core Nostr specifications (NIP-01, NIP-33) and leverages NIP-78 (Application-specific Data) effectively for its distributed locking mechanism. Protocol usage is centralized in `src/lock-ops.mjs` and `src/relay-health.mjs`.

## Findings

### 1. Nostr Protocol Compliance
- **NIP-01 (Basic Protocol):** Fully implemented via `nostr-tools`.
- **NIP-33 (Parameterized Replaceable Events):** Correctly used for managing lock state updates via `d` tags.
- **NIP-40 (Expiration Timestamp):** Implemented in `src/lock-ops.mjs`. The `expiration` tag is parsed and respected during lock validation, ensuring stale locks are automatically pruned.
- **NIP-78 (Application-specific Data):** Kind 30078 is the primary vehicle for lock data, aligning with the spec's intent for non-social app data.

### 2. Custom Protocol Usage
- **Relay Health Probes (Kind 27235):** `src/relay-health.mjs` uses an ephemeral event Kind `27235` to test relay write/read round-trip capability. This appears to be an internal convention or experimental kind not yet standardized.
- **Risk Assessment:** Low. The events are ephemeral and scoped to the application namespace.

### 3. Web & Transport
- **HTTP/1.1:** `src/dashboard.mjs` implements a standard Node.js HTTP server for the dashboard UI.
- **WebSocket:** Raw `ws` usage in `src/relay-health.mjs` provides fine-grained control for connection health checks, complementing the higher-level `SimplePool` abstraction.

### 4. Gaps & Unknowns
- **NIP-42 (Authentication):** Not currently implemented. As relay ecosystem evolves, paid/auth-required relays may become inaccessible without NIP-42 support.

## Recommendations

1. **Document Custom Kinds:** Ensure Kind 27235 is clearly documented as internal-only to prevent confusion with standardized kinds.
2. **Monitor NIP-42:** Keep NIP-42 on the roadmap if relay reliability issues arise due to auth requirements.
3. **Maintain Dependency Hygiene:** Continue pinning `nostr-tools` to avoid upstream breaking changes in protocol implementation.
