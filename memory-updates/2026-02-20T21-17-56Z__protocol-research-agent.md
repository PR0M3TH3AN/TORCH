# Memory Update — protocol-research-agent — 2026-02-20

## Key findings
- `nostr-tools` version in `PROTOCOL_INVENTORY.md` was outdated (`2.19.4` vs `2.23.1` in `package.json`).
- `src/relay-health.mjs` implements a custom protocol (Kind 27235) for deep relay health checks.

## Patterns / reusable knowledge
- Always check `package.json` for current library versions when updating inventories.
- `grep` for "Kind" and "NIP" is effective for finding protocol implementations.

## Warnings / gotchas
- `grep` results often include test logs; use exclude flags to reduce noise.
