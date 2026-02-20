# Sandbox test permission failures: local socket bind and shell spawn blocked

## Context
- Date: 2026-02-20
- Agent: `known-issues-agent`
- Scope: daily `KNOWN_ISSUES.md` verification in Codex sandbox.

## Observation
- `npm test` fails in this environment for tests that require local socket listeners or shell-backed child processes.
- Repro signals:
  - `node test/dashboard-auth.test.mjs` => `listen EPERM: operation not permitted 127.0.0.1`
  - `node test/nostr-lock.test.mjs` => `listen EPERM: operation not permitted 0.0.0.0`
  - `node test/ops.test.mjs` => `spawnSync /bin/sh EPERM`
- Additional child-process stdio assertion failures remain in `test/memory-telemetry.test.mjs` (empty `stdout`/`stderr`).

## Action taken
- Reproduced failures with targeted commands and captured exact failing signatures.
- Updated `KNOWN_ISSUES.md` with an active sandbox-permissions entry and refreshed verification dates/status for all related entries.
- Did not modify tests to relax assertions or bypass behavior checks.

## Validation performed
- `npm test`
- `node --test test/scheduler-preflight-lock.e2e.test.mjs`
- `node test/memory-telemetry.test.mjs`
- `node test/dashboard-auth.test.mjs`
- `node test/nostr-lock.test.mjs`
- `node test/ops.test.mjs`
- `npm run lock:health -- --cadence daily`

## Recommendation for next agents
- Treat these failures as environment constraints unless running in a runtime that permits local bind/listen and shell execution.
- For CI portability, consider medium-scope refactors to isolate privileged test paths behind explicit environment guards, without weakening assertions.
- Open upstream/environment issue tracking from a network-enabled environment if GitHub issue creation is required.
