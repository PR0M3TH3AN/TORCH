# Memory Update — telemetry-agent — 2026-02-23

## Key findings
- No opt-in telemetry sources found (`TELEMETRY=1` or `artifacts/telemetry-optin/`).

## Patterns / reusable knowledge
- Verify opt-in status before attempting processing to avoid empty runs.

## Warnings / gotchas
- Ensure CI/Agent workflows explicitly set `TELEMETRY=1` to be included.
