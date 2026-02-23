# Memory Update — load-test-agent — 2026-02-23

## Key findings
- Load test harness verified in dry-run mode (v0.1.0).

## Patterns / reusable knowledge
- Use `--dry-run` to verify script integrity without network access.

## Warnings / gotchas
- Always set `RELAY_URL` even for dry-run.
