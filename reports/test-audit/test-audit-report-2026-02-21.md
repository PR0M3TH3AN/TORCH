# Test Audit Report - 2026-02-21

## Scope
- Agent: `test-audit-agent`
- Cadence: `daily`
- Prompt: `src/prompts/daily/test-audit-agent.md`
- Focus: scenario fidelity, determinism, and cheat-vector resistance in audit tooling/tests.

## Discovery
- Test runner entry points:
  - `npm test` -> `npm run validate:scheduler && npm run test:integration:e2e && node --test --test-timeout=30000 test/*.test.mjs test/*.test.js`
  - `npm run test:integration:e2e` -> `node --test test/scheduler-preflight-lock.e2e.test.mjs`
- CI entry points:
  - `.github/workflows/ci.yml` runs `npm run lint` and `npm test`.
- Audit tools used:
  - `scripts/test-audit/run-static-analysis.mjs`
  - `scripts/test-audit/run-flaky-check.mjs`

## Findings
1. **High - flakiness signal could be silently false-green**
   - `scripts/test-audit/run-flaky-check.mjs` parsed only piped child stdout and produced `{}` in this environment, even when tests emitted pass/fail TAP lines.
   - Risk: audit report can claim "no flakes" with zero observed outcomes.
2. **Medium - unresolved scheduler e2e platform mismatch**
   - `test/scheduler-preflight-lock.e2e.test.mjs` still fails on `platform` expectation (`unknown` expected vs `codex` actual).
   - Treated as unresolved spec/contract mismatch; test expectation was not weakened.
3. **Low - static-analysis noise**
   - `reports/test-audit/suspicious-tests.json` flags `test/fixtures/memory-fixtures.js` for assertions (fixture-only file), plus intentional `setTimeout` usages in timing-related tests.

## Changes Applied
- Hardened `scripts/test-audit/run-flaky-check.mjs` to:
  - force TAP reporter output to per-run files (`flaky-run-*.tap`),
  - parse TAP files deterministically,
  - emit run diagnostics (`flakiness-runs.json`),
  - fail closed when zero outcomes are observed.
- Added integration regression coverage:
  - `test/test-audit-run-flaky-check.test.mjs`
  - fixtures: `test/fixtures/flaky-check/pass.fixture.test.mjs`, `test/fixtures/flaky-check/fail.fixture.test.mjs`

## Scenario List (Given/When/Then)
- `SCN-flaky-check-captures-results`
  - Given deterministic pass and fail fixture tests,
  - When `run-flaky-check.mjs` executes 5 runs,
  - Then `flakiness-matrix.json` records 5 pass counts for the pass fixture and 5 fail counts for the fail fixture.
- `SCN-flaky-check-fail-closed-on-no-signal`
  - Given no observed TAP outcomes across all runs,
  - When `run-flaky-check.mjs` completes,
  - Then the command exits non-zero to prevent false-green flakiness reports.

## Validation
- `node scripts/test-audit/run-static-analysis.mjs --output-dir reports/test-audit`
- `node scripts/test-audit/run-flaky-check.mjs --output-dir reports/test-audit test/scheduler-preflight-lock.e2e.test.mjs test/scheduler-lock-failure-schema.contract.test.mjs test/lock-ops-publish-retry.test.mjs`
- `node --test test/test-audit-run-flaky-check.test.mjs`
- `node test/scheduler-preflight-lock.e2e.test.mjs` (repro unresolved issue)

## Needs Spec Clarification
- Scheduler e2e platform assertion source of truth is unclear in this environment.
- Candidate scenarios:
  - Given scheduler completion log frontmatter, when runtime platform is detected/declared, then platform value should come from one canonical source (`AGENT_PLATFORM` or detector), consistently in code and tests.

## Test Integrity Note
```yaml
test_integrity_note:
  change_type: ["new_tests", "refactor_tests", "flake_fix"]
  scenarios:
    - id: SCN-flaky-check-captures-results
      given: "A deterministic pass fixture and deterministic fail fixture"
      when: "run-flaky-check executes five node:test runs"
      then: "flakiness matrix records pass/fail counts per fixture across all runs"
    - id: SCN-flaky-check-fail-closed-on-no-signal
      given: "No TAP outcomes are captured for all runs"
      when: "run-flaky-check finishes aggregation"
      then: "script exits non-zero instead of emitting a false-green empty matrix"
  observable_outcomes:
    - "reports/test-audit/flakiness-matrix.json includes concrete pass/fail counters"
    - "reports/test-audit/flakiness-runs.json includes per-run observed counts and exit codes"
    - "process exit code is non-zero when observed outcome count is zero"
  determinism_controls:
    - "Fixture tests are deterministic and local"
    - "TAP reporter output is written to explicit files instead of environment-sensitive piped stdio"
  anti_cheat_rationale:
    prevents:
      - "hard-coded empty flakiness output"
      - "false-green flake audit when no outcomes are parsed"
      - "environment-dependent stdout capture masking failures"
      - "retry/sleep-based flake masking"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```
