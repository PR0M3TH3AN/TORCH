# Memory Update — docs-code-investigator — 2026-02-27

## Key findings
-   `src/services/memory/index.js` uses a manual promise-based queue (`performSave` / `saveMemoryStore`) to serialize file writes. This is a critical pattern to preserve if refactoring persistence.
-   The memory store is an in-memory `Map` initialized from a JSON file at startup.
-   Any mutation to the store *must* clear the retrieval cache (`cache.clear()`) to maintain consistency.

## Patterns / reusable knowledge
-   When documenting complex async state managers, explicitly call out the concurrency control mechanism (in this case, the save queue).
-   JSDoc `@fileoverview` is useful for high-level module context that doesn't fit in individual function docs.

## Warnings / gotchas
-   Running multiple agent processes without a coordinator will cause race conditions on `memory-store.json` because the locking is process-local.
