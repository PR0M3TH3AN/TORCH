# Codex environment test failures: scheduler platform assertion and memory telemetry capture

## Context
- Date: 2026-02-20
- Agent: `docs-code-investigator`
- Validation stage for documentation-only updates (`src/services/memory/index.js`).

## Observation
- `npm test` fails in `test/scheduler-preflight-lock.e2e.test.mjs`.
- Failure detail: first e2e assertion expects frontmatter platform to be `unknown`, but scheduler log in this environment reports `platform: codex`.
- Targeted memory test bundle (`node --test test/memory-*.test.mjs test/memory.test.js`) fails in `test/memory-telemetry.test.mjs`.
- Direct run (`node test/memory-telemetry.test.mjs`) shows fixture child process exits with code `0` but both `stdout` and `stderr` are empty, failing assertions that expect `[PASS]` and `TORCH-MEMORY` output.

## Action taken
- Confirmed failures are reproducible and unrelated to documentation edits.
- Captured reproductions with direct command runs to reveal assertion details.
- Updated `KNOWN_ISSUES.md` with active issue entries for both failures.

## Validation performed
- `npm run lint` (pass)
- `npm test` (fails in `test/scheduler-preflight-lock.e2e.test.mjs`)
- `node --test test/scheduler-preflight-lock.e2e.test.mjs`
- `node test/scheduler-preflight-lock.e2e.test.mjs`
- `node --test test/memory-*.test.mjs test/memory.test.js`
- `node test/memory-telemetry.test.mjs`

## Recommendation for next agents
- Treat these as environment-sensitive test failures until assertions are aligned with Codex platform semantics and child-process output behavior.
- If updating tests, follow spec-correction protocol and preserve strict behavioral intent.
- Keep `KNOWN_ISSUES.md` dates/status current after remediation.

## Update 2026-02-21

### Context
- Agent: `test-audit-agent`
- Scope: scenario-first audit run using `scripts/test-audit/run-flaky-check.mjs` and targeted scheduler e2e verification.

### Observation
- The scheduler platform mismatch is still reproducible:
  - Expected in test assertion: `platform: unknown` (derived from test-side `detectPlatform() || 'unknown'`)
  - Actual log frontmatter: `platform: codex`
- Reproduced with:
  - `node test/scheduler-preflight-lock.e2e.test.mjs`
  - `node --test test/scheduler-preflight-lock.e2e.test.mjs`

### Action taken
- Reclassified the issue in `KNOWN_ISSUES.md` from Resolved back to Active (`KNOWN-ISSUE-scheduler-preflight-platform`) with updated workaround and verification date.
- Did not weaken/modify scenario expectations in the e2e test without explicit spec correction.

### Validation performed
- `node test/scheduler-preflight-lock.e2e.test.mjs` (fails with platform mismatch)
- `node --test test/scheduler-preflight-lock.e2e.test.mjs` (fails)

### Recommendation for next agents
- Resolve via spec correction only:
  1. Decide canonical platform source for scheduler logs in fixtures (`AGENT_PLATFORM` fallback vs runtime detector).
  2. Update assertion to match documented scheduler behavior, not incidental environment state.
