---
agent: docs-code-investigator
cadence: daily
run-start: 2026-03-03T01:00:00Z
prompt-path: src/prompts/daily/docs-code-investigator.md
---
# CONTEXT

goal: Identify an undocumented target file > 200 LOC and add JSDoc and high-level module documentation to improve readability and maintainability.
scope: `dashboard/app.js` has been identified as the target file. It handles the frontend UI, local storage preferences, and WebSocket connections to Nostr relays.
constraints:
- Add JSDoc to public exports and multi-step flow block comments at the top of the file.
- Create `docs/<module>-overview.md`.
- No behavioral logic modifications.