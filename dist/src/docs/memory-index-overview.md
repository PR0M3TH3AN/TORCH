# Memory Service Index Overview (`src/services/memory/index.js`)

## What this module does
`src/services/memory/index.js` is the orchestration layer for TORCH memory ingestion, retrieval, pruning, and admin operations.

It coordinates lower-level modules (`ingestor`, `retriever`, `pruner`, `cache`, `scheduler`, feature flags), persists a process-local `Map` store to `.scheduler-memory/memory-store.json`, and exposes APIs used by CLI commands and scheduler memory workflows.

## Where it fits
- Primary callers:
  - CLI entrypoints in `src/lib.mjs:28` and command handling in `src/lib.mjs:640`.
  - Scheduler memory pipelines in `scripts/memory/retrieve.mjs:1` and `scripts/memory/store.mjs:1`.
  - Prompt context formatter via memory service interface in `src/services/memory/formatter.js:173`.
- Side effects:
  - Filesystem read/write (`.scheduler-memory/memory-store.json`).
  - In-process cache invalidation and stats mutation.
  - Telemetry/metrics emission hooks.

## Typical sequence (ingest -> retrieve -> prune)
1. Caller sends raw events to `ingestEvents(events, options)`.
2. `ingestMemoryWindow` validates/transforms/summarizes and writes through repository.
3. Service clears retrieval cache to avoid stale ranked results.
4. Caller queries `getRelevantMemories({ agent_id, query, ... })`.
5. Service returns cache hit or ranks records, updates `last_seen`, and caches result.
6. Optional `runPruneCycle` removes stale unpinned records (or reports candidates in dry-run mode).

## Public API summary
- `ingestEvents(events, options)`
  - Stores event-derived memory records.
  - Observable outputs: persisted records + telemetry/metrics.
- `getRelevantMemories(params)`
  - Returns ranked top-k memory records for query context.
  - Observable outputs: ranked records + telemetry/metrics + updated `last_seen`.
- `runPruneCycle(options)`
  - Executes prune in `on` mode, or returns skip/dry-run metadata for `off`/`dry-run` modes.
- `pinMemory(id, options)` / `unpinMemory(id, options)`
  - Toggle `pinned` state for prune protection and retrieval weighting.
- `markMemoryMerged(id, mergedInto, options)`
  - Marks record as archived into another id.
- `listMemories(filters, options)`
  - Lists filtered memories sorted by `last_seen` descending.
- `inspectMemory(id, options)`
  - Returns one memory by id.
- `triggerPruneDryRun(options)`
  - Returns prune candidates without deleting.
- `memoryStats(options)`
  - Returns aggregate counts/rates and ingest throughput estimate.

## Main execution paths
- Ingest path:
  - Input: validated event list.
  - Output: stored `MemoryRecord[]`.
  - Side effects: repository inserts, cache clear, ingest metrics.
- Retrieval path:
  - Input: `{agent_id, query, tags, timeframe, k}`.
  - Output: ranked `MemoryRecord[]`.
  - Side effects: cache hit/miss telemetry, usage timestamp updates, retrieval metrics.
- Prune path:
  - Input: retention window + prune mode.
  - Output: pruned records (or dry-run candidates / off-mode no-op).
  - Side effects: deletes from store, save to disk, cache clear, prune metrics.
- Admin path:
  - Input: id/filter operations from CLI/admin surfaces.
  - Output: direct record/admin summaries.
  - Side effects: pin/unpin/merge mutate store and clear cache.

## Assumptions and invariants
- `memoryStore` is process-local and shared by all exports in this module.
- All state mutations that influence retrieval semantics clear cache.
- Save operations are coalesced (`currentSavePromise` + `pendingSavePromise`) to avoid overlapping writes.
- Repository injection objects must implement the methods expected by each API path (`listMemories`, `setPinned`, `markMerged`, etc.).
- Telemetry payloads are sanitized by `toSafeTelemetryPayload` to avoid high-risk raw content fields.

## Edge cases and error paths
- JSON store load failures are caught and logged; module falls back to empty `Map`.
- Save failures are caught/logged in `performSave`; callers are not failed by persistence errors from that path.
- Feature flag can force ingest skip (`isMemoryIngestEnabled`), returning `[]` with telemetry.
- Prune mode edge handling:
  - `off`: no deletion, skip telemetry event.
  - `dry-run`: returns candidates only.
- Several APIs propagate repository/ranker exceptions directly (no catch wrapper).
- No explicit retry/backoff inside this module; retry strategy is expected in callers if needed.

## Performance and concurrency considerations
- Retrieval caching is keyed by serialized query params (`JSON.stringify`), reducing repeated ranking cost.
- Throughput sample arrays are capped at 10k entries to avoid unbounded growth.
- Save coalescing collapses concurrent write bursts to at most one active write plus one queued write.
- Process-level in-memory state means multi-process deployments can drift unless coordinated externally.

## Security considerations
- ⚠️ SECURITY: This module handles user/agent-provided memory content and telemetry emission.
- `toSafeTelemetryPayload` intentionally strips `content`, `summary`, `query`, and `raw` fields to reduce accidental leakage.
- Filesystem persistence path is under working directory `.scheduler-memory`; callers should treat it as sensitive operational data.
- No cryptographic/signing logic exists in this file; avoid introducing any here without security review.

## Related files and call graph
- Direct dependencies used by this module:
  - `src/services/memory/cache.js:1`
  - `src/services/memory/ingestor.js:1`
  - `src/services/memory/retriever.js:1`
  - `src/services/memory/pruner.js:1`
  - `src/services/memory/scheduler.js:1`
  - `src/services/memory/feature-flags.js:1`
- Inbound usage:
  - `src/lib.mjs:28`
  - `scripts/memory/retrieve.mjs:1`
  - `scripts/memory/store.mjs:1`
  - `test/memory-admin.test.mjs:15`
  - `test/memory-ingest.test.mjs:3`
  - `test/memory-run-prune-cycle.test.mjs:64`

## Why it works this way
- This design prioritizes deterministic scheduler-local operation with minimal dependencies: JSON-backed persistence + in-process cache + injectable repository hooks for tests.
- The module centralizes memory lifecycle events so scheduler contracts can call stable entrypoints (`ingestEvents`, `getRelevantMemories`) with marker verification.

## When to change
- Extract persistence if multi-process consistency or transactional guarantees are required.
- Split telemetry/stats into dedicated module if eventing complexity grows.
- Replace JSON store if memory volume makes full-file rewrites too expensive.
- Refactor if cache keying/ranking inputs require versioned schema or backward-compat layers.

## Tests validating behavior
- `test/memory-ingest.test.mjs`
- `test/memory-index.test.mjs`
- `test/memory-admin.test.mjs`
- `test/memory-run-prune-cycle.test.mjs`
- `test/memory-stats.test.mjs`

Run checks:
```bash
npm run lint
npm test
```
