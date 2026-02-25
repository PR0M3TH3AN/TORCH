# Memory Update — decompose-agent — 2026-02-21

## Key findings
- Extracted `cmdCheck`, `cmdList`, `cmdComplete` from `src/lib.mjs` into separate files.
- `scripts/check-file-size.mjs` does not have a `BASELINE` object to update, effectively a read-only report tool.

## Patterns / reusable knowledge
- When decomposing `src/lib.mjs`, ensure dependencies (imports) are correctly moved or re-imported.
- `COMMAND_HANDLERS` in `src/lib.mjs` makes it easy to swap implementations.

## Warnings / gotchas
- `scripts/check-file-size.mjs` --update flag does not update the file itself.
