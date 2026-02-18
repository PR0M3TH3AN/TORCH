# Protocol Report - 2026-02-15

## Summary

This report analyzes the usage of external protocols (primarily Nostr) and related libraries in the `torch-lock` repository.

## Findings

1.  **Nostr Implementation**:
    - The repository relies heavily on `nostr-tools` for interacting with Nostr relays.
    - It uses Kind 30078 for lock events, which is appropriate for application-specific data.
    - `SimplePool` is used for managing relay connections and subscriptions.

2.  **Dependencies**:
    - `nostr-tools`: v2.19.4. This is a recent version (v2+).
    - `ws`: v8.19.0. Standard WebSocket implementation for Node.js.

3.  **Compliance**:
    - The implementation appears compliant with NIP-01 (Events, signatures, subscriptions).
    - The use of `tags` for filtering locks (`d` tag, `t` tags) aligns with Nostr best practices for parameterized replaceable events (though Kind 30078 is used).

4.  **Risks**:
    - **Relay Availability**: The system is dependent on the availability of configured relays. `src/relay-health.mjs` provides mitigation by probing health.
    - **Race Conditions**: The locking mechanism relies on relay propagation and a race check delay (`RACE_CHECK_DELAY_MS`).

## Recommendations

1.  **Monitor `nostr-tools` updates**: Keep the library updated to receive security patches.
2.  **Enhance Relay Health Checks**: Continue to refine `src/relay-health.mjs` to handle edge cases (e.g., slow relays, auth requirements).
3.  **Formalize NIP Support**: Explicitly document which NIPs are supported/required in `PROTOCOL_INVENTORY.md`.

## Artifacts Created

- `PROTOCOL_INVENTORY.md`: Initial inventory of protocols.
