# Implementation Backlog — 2026-02-21

## Triage Summary
- Items evaluated: 18
- New items added: 7
- Items retired: 2
- Items promoted to ready: 1

## Priority 1: Ready to Plan

### BACKLOG-001: Add `npm run format` script to package.json
- **Source:** `KNOWN_ISSUES.md`, `src/todo/TODO_2026-02-18.md`
- **Impact:** Unblocks formatting workflows and prevents repeated `style-agent` no-op/failure risk.
- **Scope:** Add `format` and `format:check` scripts in `package.json`; verify they run in this repo.
- **Status:** ready-to-plan
- **Acceptance:** `npm run format -- --check` and `npm run format:check` execute successfully.

### BACKLOG-002: Create `src/lib/eventSchemas.js` canonical event builders
- **Source:** weekly `event-schema-agent` failures; missing `src/lib/eventSchemas.js`
- **Impact:** Unblocks schema-related weekly work and removes repeated missing-file dead end.
- **Scope:** Extract/centralize lock-event schema builders into `src/lib/eventSchemas.js` and wire current call sites.
- **Status:** ready-to-plan
- **Acceptance:** `src/lib/eventSchemas.js` exists, is imported by lock/event code paths, and related tests pass.

### BACKLOG-003: Revise `content-audit-agent` scope to TORCH-relevant surfaces
- **Source:** `docs/agent-handoffs/incidents/2026-02-20-content-audit-no-upload-surface.md`
- **Impact:** Replaces a recurring no-op daily run with actionable audits.
- **Scope:** Update the prompt to target real TORCH docs/contracts and expected outputs.
- **Status:** ready-to-plan
- **Acceptance:** Next `content-audit-agent` run produces findings against existing TORCH files/features.

### BACKLOG-004: Implement prompt graph metadata extraction (Phase 0)
- **Source:** `docs/proposals/node-based-prompt-editor.md`
- **Impact:** Enables prompt fleet visibility, dependency mapping, and higher-quality governance analysis.
- **Scope:** Add extraction/build/validation scripts and emit graph artifact under `artifacts/prompt-graph/`.
- **Status:** ready-to-plan
- **Acceptance:** `npm run graph:build` (or equivalent script) generates a valid prompt graph including all roster agents.

### BACKLOG-012: Align scheduler preflight platform assertion with runtime contract
- **Source:** `KNOWN_ISSUES.md` (`KNOWN-ISSUE-scheduler-preflight-platform`), `reports/test-audit/test-audit-report-2026-02-21.md`
- **Impact:** Removes a deterministic false failure in scheduler E2E validation.
- **Scope:** Define a single platform source-of-truth and update scheduler/test expectations accordingly via spec-correction protocol.
- **Status:** ready-to-plan
- **Acceptance:** `node --test test/scheduler-preflight-lock.e2e.test.mjs` passes without weakening scenario assertions.

## Priority 2: Needs Scoping

### BACKLOG-005: Implement `e2e-agent` for scenario-first E2E test maintenance
- **Source:** `docs/AGENT_COVERAGE_GAPS.md`
- **Impact:** Adds explicit ownership for scenario-level regressions and anti-cheat integrity.
- **Scope:** New weekly agent plus deterministic validation workflow.
- **Status:** needs-scoping

### BACKLOG-006: Implement `memory-health-agent` for memory subsystem auditing
- **Source:** `docs/AGENT_COVERAGE_GAPS.md`
- **Impact:** Adds quality controls for retrieval relevance and memory lifecycle behavior.
- **Scope:** New weekly agent with measurable health criteria.
- **Status:** needs-scoping

### BACKLOG-007: Implement `relay-health-agent` for relay stability operations
- **Source:** `docs/AGENT_COVERAGE_GAPS.md`, relay incidents in `KNOWN_ISSUES.md`
- **Impact:** Improves lock reliability and actionable relay operations beyond current preflight checks.
- **Scope:** Define monitor/rotation policy and integration boundaries with existing `lock:health` flows.
- **Status:** needs-scoping

### BACKLOG-008: Implement project-type prompt packages system
- **Source:** `docs/proposals/prompt-packages.md`
- **Impact:** Improves onboarding and relevance outside TORCH’s own repo shape.
- **Scope:** `torch init` package selection, metadata schema, and package-aware prompt installation.
- **Status:** needs-scoping

### BACKLOG-013: Stabilize `test/memory-telemetry.test.mjs` child-process signal capture
- **Source:** `KNOWN_ISSUES.md` (`KNOWN-ISSUE-memory-telemetry-stdout-stderr`)
- **Impact:** Removes recurring false negatives in memory telemetry test coverage.
- **Scope:** Investigate environment-sensitive stdio capture and replace with deterministic boundary assertions.
- **Status:** needs-scoping

### BACKLOG-014: Enforce artifact metadata requirements at prompt/template level
- **Source:** `docs/agent-handoffs/incidents/2026-02-20-pr-review-agent-artifact-metadata-failure.md`, `task-logs/daily/2026-02-20T04-25-38Z__load-test-agent__failed.md`
- **Impact:** Reduces scheduler failures due to missing or malformed run artifacts.
- **Scope:** Add explicit metadata template/guardrails for all agent prompts and verify against `verify-run-artifacts` expectations.
- **Status:** needs-scoping

### BACKLOG-015: Consolidate persistent TODO debt into actionable tracked items
- **Source:** `src/todo/` backlog sprawl, `artifacts/todos.txt`
- **Impact:** Prevents repeated rediscovery loops and improves planner/builder throughput.
- **Scope:** Define archival policy for stale TODO artifacts and create a maintained actionable TODO registry.
- **Status:** needs-scoping

## Priority 3: Deferred

### BACKLOG-009: Build standalone binary distribution (Node.js SEA or pkg)
- **Source:** `docs/architecture/distribution-plan.md`
- **Impact:** Removes Node.js runtime requirement for some users.
- **Scope:** Build/release pipeline work across platforms.
- **Status:** deferred

### BACKLOG-010: Build hosted dashboard at `dashboard.torch.sh`
- **Source:** `docs/architecture/distribution-plan.md`
- **Impact:** Provides shareable dashboard access without local runtime.
- **Scope:** Hosting/domain/release operational work.
- **Status:** deferred

### BACKLOG-011: Implement `migration-agent` for database migration auditing
- **Source:** `docs/AGENT_COVERAGE_GAPS.md`
- **Impact:** Adds migration-focused audit coverage.
- **Scope:** New weekly agent and migration verification checks.
- **Status:** deferred

### BACKLOG-016: Implement `prompt-contract-agent`
- **Source:** `docs/AGENT_COVERAGE_GAPS.md`
- **Impact:** Dedicated ownership for prompt-contract drift prevention.
- **Scope:** New weekly agent; likely overlaps with existing prompt-maintenance/governance workflows.
- **Status:** deferred

### BACKLOG-017: Implement `skills-agent`
- **Source:** `docs/AGENT_COVERAGE_GAPS.md`
- **Impact:** Ongoing maintenance for skill definitions and usage quality.
- **Scope:** New low-priority weekly agent.
- **Status:** deferred

### BACKLOG-018: Implement `landing-page-agent`
- **Source:** `docs/AGENT_COVERAGE_GAPS.md`
- **Impact:** Dedicated ownership of landing-page updates and release messaging.
- **Scope:** New low-priority weekly agent.
- **Status:** deferred

## Completed (Last 4 Weeks)
- No backlog-tracked items have been transitioned to `completed` yet.

## Retired

### RETIRED-001: `content-audit-agent` upload/contribution audit scope
- **Rationale:** TORCH has no upload/contribution product surface; replaced by `BACKLOG-003` scoped to real TORCH surfaces.
- **Retired:** 2026-02-21

### RETIRED-002: `plan-agent-architecture` proposal as a net-new pipeline request
- **Rationale:** Core pipeline agents (`proposal-triage-agent`, `plan-agent`, `builder-agent`) already exist in weekly roster and prompt set; remaining work is tracked as discrete backlog items.
- **Retired:** 2026-02-21

### RETIRED-003: Goose Desktop wrapper defects as direct repository backlog items
- **Rationale:** ETXTBSY and exit-code swallowing are upstream Goose wrapper defects outside this repo’s control; keep in `KNOWN_ISSUES.md`/incident notes until upstream remediation lands.
- **Retired:** 2026-02-21
