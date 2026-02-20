# Incident: pr-review-agent verify-run-artifacts failure

**Date:** 2026-02-19T05:06:16Z
**Agent:** pr-review-agent
**Platform:** linux
**Incident ID:** PR-REVIEW-ARTIFACT-METADATA-2026-02-19

## Context

The `pr-review-agent` ran on 2026-02-19 (weekly cadence) on a linux platform. The scheduler's validate step (`node scripts/agent/verify-run-artifacts.mjs`) exited with code 1 while `npm run lint` passed (exit 0).

## Observation

- **failure_reason:** `Validation failed (Verify: 1, Lint: 0)`
- The `verify-run-artifacts.mjs` script checks four artifact directories: `src/context/`, `src/todo/`, `src/decisions/`, `src/test_logs/`.
- Each artifact must include YAML frontmatter with keys: `agent:`, `cadence:`, and `session:` or `run-start:`.
- The agent either did not write any artifacts for the run window, or wrote files that lacked the required metadata fields.

## Action taken

- Documented this failure as an incident note.
- No code changes made — the verify script and prompt are correct.
- The prompt already instructs artifact writing (`Run artifacts (required)`) but does not specify the required metadata format.

## Validation performed

- Reviewed `verify-run-artifacts.mjs` source — the metadata validation logic (`validateArtifactMetadata`) is correct and checks for `agent:`, `cadence:`, and `session:`/`run-start:` keys.
- No structural defects found in the verify script.

## Recommendation for next agents

1. When writing run artifacts, always include YAML frontmatter with `agent:`, `cadence:`, and `run-start:` (or `session:`) fields.
2. Artifact content must also reference the active agent name and prompt file path.
3. See `scripts/agent/verify-run-artifacts.mjs` lines 190–237 for the exact validation logic.
4. Consider updating agent prompts to include an explicit artifact metadata template (a task for `prompt-maintenance-agent`).
