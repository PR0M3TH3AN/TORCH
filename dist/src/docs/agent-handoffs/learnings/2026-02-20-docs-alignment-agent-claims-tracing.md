# Docs Alignment Agent: Claims Tracing Pattern

- **Context:** docs-alignment-agent run 2026-02-20. Daily pass auditing docs/lib-overview.md, docs/lock-ops-overview.md, docs/memory-index-overview.md, docs/removal.md, docs/architecture/system-overview.md, docs/AGENT_COVERAGE_GAPS.md, src/constants.mjs USAGE_TEXT.
- **Observation:** Four confirmed doc/code divergences found and fixed:
  1. `docs/lib-overview.md` claimed RACE_CHECK_DELAY_MS = 2000ms; actual is 1500ms (src/constants.mjs:2).
  2. `src/constants.mjs` USAGE_TEXT said `NOSTR_LOCK_QUERY_TIMEOUT_MS` default is 15000; actual default is 30000 (`DEFAULT_QUERY_TIMEOUT_MS`). The 15000 value matches `DEFAULT_PUBLISH_TIMEOUT_MS` — likely copy-paste confusion between the two timeouts.
  3. `docs/removal.md` env var cleanup list was missing 4 vars: `NOSTR_LOCK_PUBLISH_TIMEOUT_MS`, `NOSTR_LOCK_MIN_SUCCESSFUL_PUBLISHES`, `NOSTR_LOCK_RELAY_FALLBACKS`, `NOSTR_LOCK_MIN_ACTIVE_RELAY_POOL`.
  4. `docs/AGENT_COVERAGE_GAPS.md` claimed "playwright dependency" — Playwright is not in package.json; E2E tests use Node.js built-in `--test` runner.
- **Action taken:** Fixed all four issues with minimal, targeted edits.
- **Validation performed:** Grep confirmed exact corrected values in all edited files post-edit.
- **Recommendation for next agents:**
  1. When auditing docs, always trace numeric constants (timeouts, delays, counts) to `src/constants.mjs` — these drift most often.
  2. The USAGE_TEXT in `src/constants.mjs` is the CLI `--help` string — verify its defaults match the exported constants above it.
  3. `docs/removal.md` env var list must stay in sync with `src/torch-config.mjs` — the four new relay-reliability vars are the most commonly missed.
  4. When AGENT_COVERAGE_GAPS.md mentions technology dependencies, verify against `package.json` before trusting the claim.
