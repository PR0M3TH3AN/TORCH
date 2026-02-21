# Memory Update — refactor-agent — 2026-02-21

## Key findings
- Extracted `cmdRemove` successfully.
- `src/ops.mjs` was over 800 LOC, now lighter.

## Patterns / reusable knowledge
- When extracting commands, remember to move or duplicate helper functions they depend on, or export them if shared.
- Tests often need renaming and import updates.

## Warnings / gotchas
- `test/ops-remove.test.mjs` was renamed to `test/cmd-remove.test.mjs`.
