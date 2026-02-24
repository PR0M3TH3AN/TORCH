# Memory Update — protocol-research-agent — 2026-02-24

## Key findings
- NIP-04 (Encrypted Direct Message) and NIP-42 (Authentication) are not implemented in the codebase.
- Relay health probes use custom Kind 27235 via raw WebSocket connections.

## Patterns / reusable knowledge
- `src/relay-health.mjs` contains isolated WebSocket logic using `nostr-tools/pure`.

## Warnings / gotchas
- `PROTOCOL_INVENTORY.md` statuses should be verified against code, not just assumed from lack of documentation.
