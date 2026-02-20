# Agent Coverage Gaps

This document identifies areas of the TORCH repository that lack specific agent coverage and recommends new agents to fill these gaps.

## Summary of Identified Gaps

| Gap | Evidence | Proposed Agent |
| :--- | :--- | :--- |
| **Database Migrations** | `migrations/` directory and SQL files present. | `migration-agent` |
| **E2E Testing** | `test/` integration/e2e files (Node.js `--test`). | `e2e-agent` |
| **Memory Subsystem** | `scripts/memory/`, `.scheduler-memory/` exist. | `memory-health-agent` |
| **Relay Stability** | `src/relay-health.mjs` and known relay flakiness. | `relay-health-agent` |
| **Skills Management** | `skills/` directory and `torch-basics.md`. | `skills-agent` |
| **Landing Page** | `landing/` directory exists. | `landing-page-agent` |
| **Prompt Contracts** | `scripts/validate-prompt-contract.mjs` and recurring violations. | `prompt-contract-agent` |

---

## Detailed Recommendations

### 1. `migration-agent`
- **Gap**: No agent monitors or audits the `migrations/` directory.
- **Mission**: Audit pending migrations, ensure schema consistency, validate rollback scripts, and ensure migrations follow project naming conventions.
- **Priority**: Medium

### 2. `e2e-agent`
- **Gap**: E2E/integration tests exist (e.g., `test/scheduler-preflight-lock.e2e.test.mjs` via Node.js `--test`), but no agent is dedicated to scenario maintenance.
- **Mission**: Maintain E2E scenarios, fix flaky tests, and ensure the dashboard and scheduler flow remain functional across protocol changes.
- **Priority**: High (given the "Scenario-First" mandate in `AGENTS.md`)

### 3. `memory-health-agent`
- **Gap**: The memory subsystem (ingest, retrieve, prune) is a core part of TORCH but lacks a dedicated quality auditor.
- **Mission**: Audit memory retrieval relevance, ensure embeddings are healthy, and manage long-term memory pruning policies.
- **Priority**: High

### 4. `relay-health-agent`
- **Gap**: Relay instability is a recurring issue (`KNOWN_ISSUES.md`).
- **Mission**: Continuously monitor relay performance, automatically rotate unhealthy relays in `torch-config.json`, and manage relay quarantine states.
- **Priority**: High

### 5. `skills-agent`
- **Gap**: The `skills/` directory contains agent guidance that needs periodic auditing.
- **Mission**: Audit and update agent skills, ensuring they reflect current protocol standards and tool availability.
- **Priority**: Low

### 6. `landing-page-agent`
- **Gap**: The `landing/` page is a separate entity from the dashboard and needs maintenance.
- **Mission**: Update the landing page with the latest release information, ensure the "Offline Bundle" links work, and maintain site aesthetic.
- **Priority**: Low

### 7. `prompt-contract-agent`
- **Gap**: Recurring prompt contract violations despite automated scripts.
- **Mission**: Specifically focused on ensuring all prompts in `src/prompts/` follow the latest shared agent run contract and metadata standards.
- **Priority**: Medium
