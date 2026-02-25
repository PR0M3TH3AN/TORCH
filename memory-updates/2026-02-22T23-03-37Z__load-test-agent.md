# Memory Update — load-test-agent — 2026-02-22

## Key findings
- Verified `load-test.mjs` harness works correctly against a local ephemeral relay (`scripts/agent/simple-relay.mjs`).
- Dry-run mode defaults to true; explicit `--dry-run 0` is required for live tests.

## Patterns / reusable knowledge
- Use `scripts/agent/simple-relay.mjs` for safe local load testing without external dependencies.
- `load-test.mjs` generates reports in `reports/load-test/`.

## Warnings / gotchas
- Ensure local relay port binding works in the environment (`127.0.0.1`).
