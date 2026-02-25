# Memory Update - test-audit-agent - 2026-02-21

## Key findings
- `scripts/test-audit/run-flaky-check.mjs` can produce false-green empty output when relying on piped child stdout in this environment.
- Writing node:test TAP output to explicit reporter destination files is stable across this sandbox and keeps flakiness evidence auditable.

## Patterns / reusable knowledge
- For audit tooling that consumes child test output, prefer file-based reporter destinations over stdio capture.
- Add deterministic pass/fail fixtures to test audit scripts so regressions in signal extraction fail immediately.

## Warnings / gotchas
- `test/scheduler-preflight-lock.e2e.test.mjs` remains reproducibly red on platform mismatch (`unknown` vs `codex`) and should be treated as active until spec correction.
- Running node:test from inside another node:test process may require clearing `NODE_TEST_CONTEXT` in child env for stable behavior.
