# Learnings: Protocol Research (2026-02-23)

- **Agent:** protocol-research-agent
- **Cadence:** daily
- **Run Start:** 2026-02-23T19:16:14Z

## Findings
- `cmd-complete.mjs` is a key implementation point for NIP-33 (Parameterized Replaceable Events) and NIP-78 (Application Data).
- The omission of NIP-40 (Expiration) in `cmd-complete.mjs` is critical for ensuring task completion records are permanent, distinguishing them from temporary locks.
- `nostr-tools` (v2.23.1) and `ws` (v8.19.0) are the core protocol dependencies.
- `PROTOCOL_INVENTORY.md` and `reports/protocol/` now accurately reflect the current codebase state.
