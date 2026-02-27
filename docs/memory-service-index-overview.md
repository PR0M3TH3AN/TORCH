# Memory Service Overview (`src/services/memory/index.js`)

This document provides a high-level overview of the `src/services/memory/index.js` module, which orchestrates memory ingestion, retrieval, pruning, and persistence for the TORCH agent system.

## What this module does

`src/services/memory/index.js` acts as the **central controller** for the agent memory system. It coordinates:

1.  **Ingestion**: Validating raw events, generating summaries, and persisting them.
2.  **Retrieval**: Fetching relevant memories based on semantic similarity (or simple filtering) and updating usage stats.
3.  **Pruning**: Identifying and removing stale, unpinned memories to keep the store manageable.
4.  **Persistence**: Managing an in-memory store backed by a JSON file (`.scheduler-memory/memory-store.json`), with serialized writes to prevent corruption.
5.  **Caching**: Providing a short-lived cache for retrieval queries to improve performance within a single run.

It serves as the main API surface for agents and the scheduler to interact with long-term memory.

## Key Flows

### 1. Ingestion Flow (`ingestEvents`)

1.  **Validate**: Checks input events against schema.
2.  **Ingest**: Calls `ingestMemoryWindow` (in `ingestor.js`) to process events.
3.  **Persist**: Writes new records to the in-memory store and triggers a save.
4.  **Invalidate**: Clears the retrieval cache (`cache.clear()`) because new data might change query results.
5.  **Telemetry**: Emits metrics and telemetry events.

### 2. Retrieval Flow (`getRelevantMemories`)

1.  **Check Cache**: Returns cached results if the exact query params match.
2.  **List/Filter**: Fetches all memories or a filtered subset from the store.
3.  **Rank**: Calls `filterAndRankMemories` (in `retriever.js`) to score relevance (e.g., using embeddings or keyword matching).
4.  **Update Usage**: Updates `last_seen` timestamp for retrieved memories (async, fire-and-forget).
5.  **Cache**: Stores the ranked result in the retrieval cache.
6.  **Return**: Returns the top-k memories.

### 3. Pruning Flow (`runPruneCycle`)

1.  **Identify Candidates**: Calls `listPruneCandidates` (in `pruner.js`) or scans the store for unpinned memories older than `retentionMs`.
2.  **Check Mode**:
    *   `off`: Does nothing.
    *   `dry-run`: Returns candidates without deleting.
    *   `on` (default): Deletes candidates from the store.
3.  **Persist**: Saves the updated store if changes occurred.
4.  **Invalidate**: Clears the retrieval cache.

## Public API

| Function | Description |
| :--- | :--- |
| `ingestEvents(events, options)` | Ingests raw agent events, creates memory records, and persists them. |
| `getRelevantMemories(params)` | Retrieves relevant memories for a query, updating usage stats. |
| `runPruneCycle(options)` | Prunes stale, unpinned memories based on retention policy. |
| `listMemories(filters, options)` | Lists memories with optional filtering (tags, agent_id, type) and pagination. |
| `inspectMemory(id, options)` | Retrieves a single memory record by ID. |
| `pinMemory(id, options)` | Pins a memory to prevent it from being pruned. |
| `unpinMemory(id, options)` | Unpins a memory, allowing it to be pruned if it becomes stale. |
| `markMemoryMerged(id, dest, options)` | Marks a memory as merged into another, effectively archiving it. |
| `triggerPruneDryRun(options)` | Simulates a prune cycle to preview what would be deleted. |
| `memoryStats(options)` | Returns aggregate statistics (counts, rates, estimated size) for observability. |

## Usage Example

```javascript
import { ingestEvents, getRelevantMemories } from './src/services/memory/index.js';

// 1. Ingest a new observation
await ingestEvents([{
  agent_id: 'test-agent',
  content: 'The api/v1/users endpoint requires Bearer auth.',
  timestamp: Date.now(),
  tags: ['api', 'auth']
}]);

// 2. Retrieve relevant context later
const memories = await getRelevantMemories({
  agent_id: 'test-agent',
  query: 'how to authenticate user api',
  k: 5
});

console.log(memories);
```

## Key Invariants & Assumptions

*   **Process-Local Truth**: The `memoryStore` Map is the source of truth for the running process. Multi-process coordination (locking) is handled at the scheduler level, not here.
*   **Serialized Writes**: `saveMemoryStore` uses a promise queue (`currentSavePromise`, `pendingSavePromise`) to ensure writes to `memory-store.json` do not overlap or race, preventing data corruption.
*   **Cache Invalidation**: Any mutation (ingest, prune, pin, merge) **must** clear the retrieval cache (`cache.clear()`) to ensure consistency.
*   **Fire-and-Forget Usage Updates**: `updateMemoryUsage` is often called without awaiting its save operation to minimize latency on the retrieval path.

## When to Change

*   **Schema Updates**: If the memory record structure changes (e.g., new fields), update `ingestor.js` and `schema.js`, and ensure `index.js` passes the new fields correctly.
*   **Persistence Strategy**: If moving from a JSON file to a real database (SQLite, Postgres), this file would need significant refactoring to replace the in-memory `Map` and `fs` calls with DB queries.
*   **Concurrency**: If multiple agents run in parallel processes writing to the *same* memory file without a coordinator, the file-based locking/serialization here is insufficient. You would need a real DB or a dedicated memory server process.
