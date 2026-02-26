# Memory Architecture Report - 2026-02-26

## Problem
Recurring merge conflicts come from shared write-hotspot files (`memory-update.md`, aggregate `memories.md`) being edited by many branches/runs.

## Goals
- Preserve reliable short-term and long-term memory for agents.
- Keep memory artifacts traceable in git.
- Minimize manual merge work and conflict risk.

## Core Learnings
1. Shared mutable files are conflict magnets.
2. Per-run immutable files are merge-friendly and auditable.
3. Aggregate views should be generated artifacts, not canonical sources of truth.
4. Reliable memory quality comes from deterministic ingestion and stable schema, not from one giant markdown file.

## Recommended Structure
- Source of truth (tracked): `memory-updates/<timestamp>__<agent>.md`
- Optional index/metadata (tracked): machine-readable pointers (run id, agent, cadence, tags, embedding/version).
- Generated read model (tracked or regenerated): `.scheduler-memory/latest/<cadence>/memories.md`

Canonical rule:
- Write path: only per-run file (`$SCHEDULER_MEMORY_FILE`).
- Read path: generated latest aggregate and/or retrieval service.
- Never write directly to shared aggregate files from agents.

## Merge Policy
- Keep `memory-updates/*.md` append-style and use `merge=union` to reduce non-overlapping merge collisions.
- For generated aggregates (`.scheduler-memory/latest/*/memories.md`):
  - Prefer keeping one side during merge, then regenerate from source files.
  - Treat as a cache/read model, not primary truth.

## Determinism and Reliability Controls
- Stable timestamp format (`YYYY-MM-DDTHH-MM-SSZ`) and agent-id naming.
- Ingestion writes structured metadata (agent, cadence, run id, tags, source path).
- Retrieval/storage must emit verifiable markers/artifacts (`MEMORY_RETRIEVED`, `MEMORY_STORED`, JSON evidence).
- Avoid retries/sleeps as correctness fixes; remove nondeterminism at source.

## Short-Term Memory Design
- Scope by cadence and recent window in retrieval queries.
- Prioritize high-signal recent memories by recency + importance + semantic match.
- Keep run-local context in artifacts (`context/`, `todo/`, `decisions/`, `test_logs/`) and link memory entries to those artifacts.

## Long-Term Memory Design
- Periodic consolidation jobs should summarize repeated findings into durable patterns.
- Promote stable insights to a curated long-term layer (policy/decision docs or pinned memory records).
- Keep provenance: every promoted insight references original run files.

## Suggested Evolution Path
1. Enforce write contract: only `$SCHEDULER_MEMORY_FILE` in `memory-updates/`.
2. Regenerate aggregates from `memory-updates/` in scheduler cycle.
3. Add lightweight memory manifest for faster deterministic rebuilds.
4. Add pruning/compaction rules that preserve high-value long-term insights.
5. Add integrity checks: fail if agents write to deprecated shared files.

## Operational Playbook for Conflicts
When conflicts involve memory files:
1. Resolve source files (`memory-updates/*`) by keeping both sides when possible.
2. Resolve aggregate files (`.scheduler-memory/latest/*/memories.md`) by choosing one side.
3. Regenerate aggregates from source files.
4. Run memory policy tests before merge completion.

## Success Criteria
- Significant drop in memory-related merge conflicts.
- No loss in retrieval quality for recent and historical tasks.
- Rebuild of aggregate memory is deterministic from tracked source files.
