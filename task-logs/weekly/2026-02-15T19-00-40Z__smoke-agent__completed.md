# smoke-agent completed

Smoke test harness implemented in `scripts/agent/smoke-test.mjs`.
Verified:
- Server start (`npx serve` or `python`)
- Relay connection (wss://relay.damus.io)
- Ephemeral identity generation
- Event publication
- Event verification (read-back)

Artifacts generated (but not committed):
- artifacts/smoke-*.log
- artifacts/smoke-*.json

Memory retrieved and stored successfully.
