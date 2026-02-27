# Memory Update — decompose-agent — 2026-02-27

## Key findings
- `scripts/check-file-size.mjs` is effective for identifying decomposition candidates, but HTML and JSON files should be manually filtered out for logic-based refactors.
- `scripts/agent/run-scheduler-cycle.mjs` is the central orchestration script and is growing in complexity.

## Patterns / reusable knowledge
- Extracting configuration and logging into separate modules (`scheduler-config.mjs`, `scheduler-logger.mjs`) is a clean pattern for reducing CLI script size.
- Using `node:fs/promises` and `node:path` consistently helps with modern ESM decomposition.

## Warnings / gotchas
- `scripts/check-file-size.mjs` does not have an `--update` flag to automatically rewrite baselines; this must be done manually or noted as a limitation.
