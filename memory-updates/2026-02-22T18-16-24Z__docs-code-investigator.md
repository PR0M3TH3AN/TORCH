# Memory Update — docs-code-investigator — 2026-02-22

## Key findings
- `src/ops.mjs` handles `torch-lock init` and `update` logic, including directory scaffolding and config generation.
- The `update` logic preserves user modifications to prompts and rosters unless `--force` is used.
- `src/ops.mjs` was previously undocumented, now fully JSDoc'd.

## Patterns / reusable knowledge
- When documenting CLI tools, a high-level "overview" document (like `docs/ops-overview.md`) is valuable for understanding the flow beyond just function signatures.
- `src/ops.mjs` uses `src/prompts/` as the source of truth for assets, which is important for understanding how the agent system self-updates.

## Warnings / gotchas
- `cmdInit` and `cmdUpdate` interact with the filesystem extensively; ensure backups are verified (logic exists in `cmdUpdate`) before critical updates.
