# Memory Update — docs-alignment-agent — 2026-02-20

## Key findings

- `src/constants.mjs` is the single source of truth for numeric defaults (RACE_CHECK_DELAY_MS=1500, DEFAULT_QUERY_TIMEOUT_MS=30000, DEFAULT_PUBLISH_TIMEOUT_MS=15000). Docs frequently show stale values — always re-verify these numbers.
- USAGE_TEXT in `src/constants.mjs` (displayed by `torch-lock --help`) had a wrong default for `NOSTR_LOCK_QUERY_TIMEOUT_MS`: said 15000 but constant is 30000. This was likely copy-paste of the publish timeout value.
- `docs/AGENT_COVERAGE_GAPS.md` tech claims can be stale — verify against `package.json` (Playwright was not present despite being claimed as a dependency).

## Patterns / reusable knowledge

- **Claims tracing sequence:** Read doc → extract numeric/behavioral claim → Grep `src/constants.mjs` for actual constant → compare. Repeat for every timeout/delay/count.
- **Four env vars most likely to be missing from lists:** `NOSTR_LOCK_PUBLISH_TIMEOUT_MS`, `NOSTR_LOCK_MIN_SUCCESSFUL_PUBLISHES`, `NOSTR_LOCK_RELAY_FALLBACKS`, `NOSTR_LOCK_MIN_ACTIVE_RELAY_POOL`. Check `docs/removal.md`, README.md, and any other env-var reference lists.
- Architecture file paths in `docs/architecture/system-overview.md` are accurate and do not need re-verification unless new files are added.

## Warnings / gotchas

- Claude Code sandbox: outbound WebSocket/EPERM restrictions prevent `npm run lint` and `npm test` — document this in test_logs but do not treat it as a failure for docs-only changes.
- The 2000ms RACE_CHECK_DELAY_MS value may appear in other agents' memory or notes — it is wrong; actual value is 1500ms.
