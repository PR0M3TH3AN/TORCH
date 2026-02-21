# Implementation Backlog — 2026-02-21

## Triage Summary
- Items evaluated: 12
- New items added: 12
- Items retired: 1
- Items promoted to ready: 4

---

## Priority 1: Ready to Plan

### BACKLOG-001: Add `npm run format` script to package.json
- **Source:** KNOWN_ISSUES.md, style-agent daily failures
- **Impact:** Unblocks `style-agent` (daily cadence — currently non-functional)
- **Scope:** Add 1-2 script entries to `package.json`
- **Status:** ready-to-plan
- **Acceptance:** `npm run format` exits 0; `style-agent` completes successfully on next daily run

### BACKLOG-002: Create `src/lib/eventSchemas.js` canonical event builders
- **Source:** event-schema-agent failures (2x on 2026-02-14)
- **Impact:** Unblocks `event-schema-agent` (weekly cadence — permanently broken)
- **Scope:** Extract event construction from `src/nostr-lock.mjs` into shared module
- **Status:** ready-to-plan
- **Acceptance:** `event-schema-agent` completes successfully; `src/nostr-lock.mjs` imports from new module; existing tests pass

### BACKLOG-003: Revise content-audit-agent scope to match TORCH's actual features
- **Source:** docs/agent-handoffs/incidents/2026-02-20-content-audit-no-upload-surface.md
- **Impact:** Eliminates permanent no-op agent run from daily cadence
- **Scope:** Rewrite `src/prompts/daily/content-audit-agent.md` to audit actual TORCH content (docs, prompts, config files) rather than nonexistent upload/contribution features
- **Status:** ready-to-plan
- **Acceptance:** content-audit-agent produces meaningful audit findings relevant to TORCH's actual codebase

### BACKLOG-004: Implement prompt graph metadata extraction (Phase 0 of node-based editor)
- **Source:** docs/proposals/node-based-prompt-editor.md
- **Impact:** Machine-readable metadata for all 44+ agent prompts; enables visualization, dependency analysis, and gap detection
- **Scope:** 4 new scripts in `scripts/prompt-graph/`, output to `artifacts/prompt-graph/graph.json`
- **Status:** ready-to-plan
- **Acceptance:** `npm run graph:build` exits 0; `artifacts/prompt-graph/graph.json` contains nodes for all roster agents with extracted metadata

---

## Priority 2: Needs Scoping

### BACKLOG-005: Implement `e2e-agent` for scenario-first E2E test maintenance
- **Source:** docs/AGENT_COVERAGE_GAPS.md (priority: HIGH)
- **Impact:** Dedicated maintainer for end-to-end test quality per AGENTS.md scenario-first mandate
- **Scope:** New weekly agent prompt + supporting test infrastructure
- **Status:** needs-scoping
- **Open Questions:** What E2E scenarios exist today? What framework to use? What's the sandbox constraint impact?

### BACKLOG-006: Implement `memory-health-agent` for memory subsystem auditing
- **Source:** docs/AGENT_COVERAGE_GAPS.md (priority: HIGH)
- **Impact:** Quality assurance for memory retrieval relevance, embedding health, and pruning effectiveness
- **Scope:** New weekly agent prompt
- **Status:** needs-scoping
- **Open Questions:** What metrics define "healthy" memory? How to test retrieval relevance?

### BACKLOG-007: Implement `relay-health-agent` for relay stability monitoring
- **Source:** docs/AGENT_COVERAGE_GAPS.md (priority: HIGH), recurring relay failures in task-logs
- **Impact:** Automated monitoring and rotation of unhealthy relays in `torch-config.json`
- **Scope:** New weekly agent prompt + relay rotation logic
- **Status:** needs-scoping
- **Open Questions:** Auto-rotation policy? How to detect relay health from sandbox? Quarantine duration?

### BACKLOG-008: Implement project-type prompt packages system
- **Source:** docs/proposals/prompt-packages.md
- **Impact:** Curated agent sets per project type, dramatically improved onboarding for non-TORCH projects
- **Scope:** `torch init` wizard, package metadata schema, dynamic roster generation
- **Status:** needs-scoping
- **Open Questions:** Package registry format? Installation mechanism? Backward compatibility with current flat roster?

---

## Priority 3: Deferred

### BACKLOG-009: Build standalone binary distribution (Node.js SEA or pkg)
- **Source:** docs/architecture/distribution-plan.md
- **Impact:** Removes Node.js requirement for non-JS projects
- **Scope:** Build scripts, CI pipeline, release automation, multi-platform binaries
- **Status:** deferred
- **Blocked By:** Requires external tooling setup (SEA/pkg), CI infrastructure, release management
- **Rationale:** High value but high complexity; core agent pipeline improvements should come first

### BACKLOG-010: Build hosted dashboard at dashboard.torch.sh
- **Source:** docs/architecture/distribution-plan.md
- **Impact:** Shareable lock visibility without local setup
- **Scope:** Static HTML/JS site, GitHub Pages config, CDN setup
- **Status:** deferred
- **Blocked By:** Hosting infrastructure decisions, domain setup
- **Rationale:** Nice-to-have; local dashboard already functional

### BACKLOG-011: Implement `migration-agent` for database migration auditing
- **Source:** docs/AGENT_COVERAGE_GAPS.md (priority: Medium)
- **Impact:** Audit pending migrations, validate rollback scripts
- **Scope:** New weekly agent prompt
- **Status:** deferred
- **Rationale:** Medium priority; higher-impact gaps should be addressed first

---

## Retired

### RETIRED-001: content-audit-agent upload/contribution audit scope
- **Rationale:** TORCH has no upload UI, API, storage, or moderation system. The agent was designed for a different product context and audits features that don't exist. Replaced by BACKLOG-003 which revises the agent's scope to match TORCH's actual features.
- **Retired:** 2026-02-21
