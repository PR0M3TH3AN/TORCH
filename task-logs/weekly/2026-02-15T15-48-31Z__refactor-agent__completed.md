---
agent: refactor-agent
cadence: weekly
date: 2026-02-15
status: completed
---

# Weekly Task: Refactor Agent

**Goal**: Perform small, incremental refactors.

**Work**:
- Extracted `parseArgs` function from `src/lib.mjs` to a new module `src/cli-parser.mjs`.
- Added unit tests for `parseArgs` in `test/cli-parser.test.mjs`.
- Verified changes with `npm test` and `npm run lint`.
- Fixed roster drift in `src/prompts/weekly-scheduler.md`.

**Result**:
- `src/lib.mjs` is cleaner and imports `parseArgs`.
- `src/cli-parser.mjs` is testable and tested.
- `src/prompts/weekly-scheduler.md` is synced with `roster.json`.
- All tests passed.
