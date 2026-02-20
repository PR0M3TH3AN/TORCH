# Memory Update — onboarding-audit-agent — 2026-02-20

## Key findings
- Onboarding flow (`npm ci` -> build -> test -> lint) is stable and accurate.
- `npm test` runs 181 tests successfully.

## Patterns / reusable knowledge
- No special environment tweaks were needed for this run.

## Warnings / gotchas
- Ensure `nostr-tools` is installed via `npm ci` before running lock checks.
