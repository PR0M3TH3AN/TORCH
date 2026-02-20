# Memory Update — log-fixer-agent — 2026-02-20

## Run summary

Daily log-fixer-agent run for 2026-02-20. Scanned last 48 hours of task logs.

## Failures found (2026-02-18 to 2026-02-20)

### Lock backend errors (transient — no action taken)
- `decompose-agent` (daily, 2026-02-20) — relay_publish_non_retryable
- `perf-optimization-agent` (weekly, 2026-02-19) — WebSocket blocked in Claude Code sandbox

### Verify-run-artifacts failure (documented)
- `pr-review-agent` (weekly, 2026-02-19, linux platform) — Verify exit 1, Lint exit 0
  - Root cause: agent did not write required run artifacts with proper metadata (agent:, cadence:, run-start:)
  - Incident documented in `docs/agent-handoffs/incidents/2026-02-20-pr-review-agent-artifact-metadata-failure.md`
  - Pattern: linux-platform agents sometimes omit required artifact metadata fields

## Key pattern observed

**Run artifact metadata is required.** The `verify-run-artifacts.mjs` script validates YAML frontmatter fields (`agent:`, `cadence:`, `run-start:` or `session:`) in each artifact file. Agents that omit these fields will fail the verify step even if the artifact content is otherwise correct.

## Recommendation

`prompt-maintenance-agent` should add explicit artifact metadata template to agent prompts to prevent recurring verify failures.
