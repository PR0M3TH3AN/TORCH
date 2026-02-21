# Proposal: Plan Agent Architecture — Closing the Idea-to-Implementation Gap

## Problem Statement

TORCH has **44 agents** generating proposals, audits, and feature ideas — but **zero agents** that evaluate those proposals, plan implementation strategies, or build approved features. The result is a growing pile of dead ends:

### Diagnosed Dead Ends (Current State)

| Dead End | Type | Why It's Stuck |
|----------|------|----------------|
| Node-based prompt editor | Proposal | 306-line design doc, zero implementation, no champion |
| Prompt packages system | Proposal | Concept doc only, never prioritized into work |
| Hybrid distribution (binary + dashboard) | Proposal | Architecture written, zero progress |
| `event-schema-agent` | Broken agent | References `src/lib/eventSchemas.js` which doesn't exist — failed 2x, never fixed |
| `content-audit-agent` | Scope mismatch | Audits upload/contribution features that don't exist in TORCH |
| `style-agent` | Missing tooling | Blocked on missing `npm run format` script — never added |
| 7 proposed agents in `AGENT_COVERAGE_GAPS.md` | Coverage gaps | Documented but no agent builds new agents |
| 77 scattered TODO files | Organizational debt | Created daily, never consolidated or triaged |
| 130+ dead artifacts | Audit fatigue | Reports generated continuously, never acted upon |

### Root Cause: Missing Pipeline Stages

The current pipeline has a structural gap. Ideas flow in but never flow through to completion:

```
CURRENT PIPELINE (broken feedback loop)

  feature-proposer-agent ──→ creates single file in features/
  prompt-gap-analysis-agent ──→ identifies gaps, writes report
  weekly-synthesis-agent ──→ summarizes activity
  governance-agent ──→ applies/rejects prompt changes

  ┌─────────────────────────────────────────────────┐
  │  MISSING: Who evaluates proposals?              │
  │  MISSING: Who plans implementation strategy?    │
  │  MISSING: Who builds multi-file features?       │
  │  MISSING: Who retires dead-end work?            │
  │  MISSING: Who closes the loop on artifacts?     │
  └─────────────────────────────────────────────────┘
```

The `feature-proposer-agent` creates single-file features in `features/`. It explicitly cannot modify existing files or execute multi-step implementations. The `governance-agent` handles prompt changes but not feature development. Nobody triages the 3 stalled proposals, 7 unimplemented agent gaps, or 15 failed task logs.

---

## Proposed Solution: Three New Pipeline Agents

Add three new weekly agents that close the gap between "idea" and "implementation":

```
PROPOSED PIPELINE (closed loop)

  IDEAS IN                          BUILT OUT
  ─────────                         ─────────
  feature-proposer-agent ─┐
  prompt-gap-analysis-agent ─┤
  docs/proposals/*.md ──────┤
  AGENT_COVERAGE_GAPS.md ───┤
  KNOWN_ISSUES.md ──────────┤
  artifacts/ reports ───────┘
                            │
                    ┌───────▼────────┐
                    │  proposal-     │  TRIAGE: Evaluates all pending
                    │  triage-agent  │  proposals, dead ends, and gaps.
                    │                │  Produces prioritized backlog.
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │  plan-agent    │  PLAN: Takes top-priority item
                    │                │  from backlog. Produces step-by-step
                    │                │  implementation plan with file list,
                    │                │  test strategy, and acceptance criteria.
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │  builder-agent │  BUILD: Executes approved plan.
                    │                │  Creates/modifies files, writes tests,
                    │                │  validates against acceptance criteria.
                    └────────────────┘
```

### Why Three Agents, Not One?

A single "do everything" agent would violate TORCH's core design principles:

1. **Single responsibility** — Each agent has one job, one prompt, one failure mode
2. **Round-robin fairness** — Three separate agents get three separate time slots; a monolithic agent would monopolize an entire weekly slot
3. **Incremental progress** — Triage can run without planning; planning can run without building; each produces value independently
4. **Auditable handoffs** — Each stage produces artifacts that the next stage consumes, creating a reviewable paper trail
5. **Failure isolation** — If the builder fails, the plan still exists for the next cycle; if triage fails, existing plans aren't affected

---

## Agent 1: `proposal-triage-agent` (Weekly)

### Identity

> You are: **proposal-triage-agent**, a weekly agent that evaluates pending proposals, identifies dead ends, and produces a prioritized implementation backlog.

### Mission

Synthesize all pending work items (proposals, coverage gaps, dead-end agents, stale artifacts) into a single prioritized backlog file that downstream agents can consume.

### Inputs (Read)

| Source | What to Extract |
|--------|----------------|
| `docs/proposals/*.md` | Active proposals and their implementation status |
| `docs/AGENT_COVERAGE_GAPS.md` | Proposed but unimplemented agents |
| `KNOWN_ISSUES.md` | Blocking issues that need tooling fixes |
| `task-logs/daily/` + `task-logs/weekly/` | Failed agent runs (pattern detection) |
| `artifacts/` | Reports that haven't driven action |
| `src/todo/` | Scattered TODO files needing consolidation |
| `features/` | Single-file features from `feature-proposer-agent` |
| `docs/agent-handoffs/incidents/` | Unresolved incidents |
| Previous backlog (`src/backlog/BACKLOG.md`) | Carry forward items not yet addressed |

### Output (Write)

**Primary artifact:** `src/backlog/BACKLOG.md`

```markdown
# Implementation Backlog — <YYYY-MM-DD>

## Triage Summary
- Items evaluated: <N>
- New items added: <N>
- Items retired (dead end): <N>
- Items promoted to ready: <N>

## Priority 1: Ready to Plan
<!-- Items with clear scope, no blockers, high value -->

### BACKLOG-001: Add `npm run format` script to package.json
- **Source:** KNOWN_ISSUES.md, style-agent failures
- **Impact:** Unblocks style-agent (daily cadence)
- **Scope:** Single line in package.json
- **Status:** ready-to-plan
- **Acceptance:** `npm run format` exits 0; style-agent completes successfully

### BACKLOG-002: Create `src/lib/eventSchemas.js`
- **Source:** event-schema-agent failures (2x)
- **Impact:** Unblocks event-schema-agent (weekly cadence)
- **Scope:** Extract event builders from `src/nostr-lock.mjs` into shared module
- **Status:** ready-to-plan
- **Acceptance:** event-schema-agent completes; `src/nostr-lock.mjs` imports from new module

## Priority 2: Needs Scoping
<!-- Items with clear value but unclear implementation -->

### BACKLOG-003: Implement Phase 0 of prompt graph extraction
- **Source:** docs/proposals/node-based-prompt-editor.md
- **Impact:** Machine-readable agent metadata for all 44 prompts
- **Scope:** 4 new scripts in `scripts/prompt-graph/`
- **Status:** needs-scoping
- **Blockers:** None
- **Open Questions:** Regex patterns may not cover all prompt variations

## Priority 3: Deferred
<!-- Items with value but dependencies or low urgency -->

## Retired (Dead Ends)
<!-- Items explicitly marked as not worth pursuing, with rationale -->

### RETIRED: content-audit-agent upload/contribution scope
- **Rationale:** TORCH has no upload UI, API, or storage. Agent audits features
  that don't exist. Recommend revising agent scope instead of building features.
```

### Triage Criteria

Items are scored on four dimensions:

| Dimension | Weight | Scoring |
|-----------|--------|---------|
| **Unblock** | 3x | Does this unblock a currently-broken agent or workflow? |
| **Value** | 2x | Does this deliver user-visible value or reduce failure rate? |
| **Scope** | 1x | Is the implementation scope clear and bounded? |
| **Risk** | -1x | Does this require architectural changes or new dependencies? |

### Retirement Rules

An item should be retired (not deferred) when:
- The feature it depends on doesn't exist and isn't planned (e.g., content-audit-agent auditing upload features)
- The proposal has been superseded by a different approach
- The cost clearly exceeds the benefit with no path to improvement
- The item has been deferred for 4+ consecutive triage cycles with no progress

### Weekly Workflow

1. Read all inputs listed above
2. Read previous `src/backlog/BACKLOG.md` if it exists
3. Evaluate each pending item against triage criteria
4. Score and rank items
5. Write updated `src/backlog/BACKLOG.md`
6. Write triage summary to `src/decisions/DECISIONS_<timestamp>.md`

---

## Agent 2: `plan-agent` (Weekly)

### Identity

> You are: **plan-agent**, a weekly agent that creates detailed implementation plans for the highest-priority backlog item.

### Mission

Take the top `ready-to-plan` item from the backlog and produce a concrete, step-by-step implementation plan that a builder agent can execute without ambiguity.

### Inputs (Read)

| Source | What to Extract |
|--------|----------------|
| `src/backlog/BACKLOG.md` | Top `ready-to-plan` item |
| Original proposal/source doc | Full context for the item |
| Relevant codebase files | Current implementation to understand integration points |
| `KNOWN_ISSUES.md` | Active blockers that might affect the plan |
| `docs/agent-handoffs/learnings/` | Past learnings relevant to this work |
| Previous plans (`src/plans/`) | Avoid re-planning already-planned items |

### Output (Write)

**Primary artifact:** `src/plans/PLAN-<backlog-id>.md`

```markdown
# Implementation Plan: BACKLOG-001 — Add `npm run format` script

## Backlog Reference
- **ID:** BACKLOG-001
- **Source:** KNOWN_ISSUES.md, style-agent failures
- **Priority:** P1 (unblocks daily agent)

## Objective
Add a working `npm run format` script to `package.json` that the
`style-agent` can invoke to auto-format code.

## Analysis
- `style-agent` prompt references `npm run format` at line 12
- `package.json` has `prettier` in devDependencies (v3.2.x)
- `.prettierrc` exists with project configuration
- No existing format script; only `lint` exists

## Implementation Steps

### Step 1: Add format script to package.json
- **File:** `package.json`
- **Change:** Add `"format": "prettier --write ."` to `scripts` object
- **Test:** `npm run format` exits 0 without errors

### Step 2: Add format check script (CI-friendly)
- **File:** `package.json`
- **Change:** Add `"format:check": "prettier --check ."` to `scripts` object
- **Test:** `npm run format:check` exits 0 after formatting

### Step 3: Validate style-agent can complete
- **Action:** Verify `style-agent` prompt references match available scripts
- **Test:** Dry-run style-agent workflow mentally against available npm scripts

## Files Modified
- `package.json` (2 lines added to `scripts`)

## Files Created
- None

## Acceptance Criteria
1. `npm run format` exits 0 and formats `.js` / `.mjs` files per `.prettierrc`
2. `npm run format:check` exits 0 after running `npm run format`
3. `style-agent` prompt commands all resolve to valid npm scripts
4. No existing tests break

## Test Strategy
- Run `npm run format` and verify exit code
- Run `npm run format:check` and verify exit code
- Run `npm test` to verify no regressions
- Run `npm run lint` to verify compatibility

## Risk Assessment
- **Low risk:** Adding scripts to package.json is additive
- **No architectural changes required**
- **Rollback:** Remove the two script lines

## Dependencies
- None — self-contained change

## Estimated Complexity
- **Simple** (< 5 file changes, no new modules)
```

### Planning Rules

1. **One plan per cycle** — Don't try to plan everything. Pick the single highest-priority `ready-to-plan` item
2. **Concrete file paths** — Every step must name the exact file(s) to create or modify
3. **Testable acceptance** — Every acceptance criterion must be verifiable by running a command
4. **No ambiguity** — A builder agent reading only this plan should be able to implement it without guessing
5. **Scope guard** — If the item is too large for a single builder cycle, break it into sub-plans and update the backlog

### Status Updates

After planning, update the backlog item's status:

```
- **Status:** ready-to-plan  →  planned (see src/plans/PLAN-BACKLOG-001.md)
```

### Weekly Workflow

1. Read `src/backlog/BACKLOG.md`
2. Select top `ready-to-plan` item
3. If no items are `ready-to-plan`, check for `needs-scoping` items and attempt to scope them (update status to `ready-to-plan` if successful)
4. Read all referenced source documents and relevant codebase files
5. Write implementation plan to `src/plans/PLAN-<backlog-id>.md`
6. Update backlog item status to `planned`
7. Write planning rationale to `src/decisions/DECISIONS_<timestamp>.md`

---

## Agent 3: `builder-agent` (Weekly)

### Identity

> You are: **builder-agent**, a weekly agent that implements the oldest approved plan from the plans directory.

### Mission

Execute an implementation plan by making the code changes described in it, running the specified tests, and verifying all acceptance criteria are met.

### Inputs (Read)

| Source | What to Extract |
|--------|----------------|
| `src/plans/PLAN-*.md` | Oldest plan with status `planned` (not `completed` or `in-progress`) |
| All files referenced in the plan | Current state of code to be modified |
| `KNOWN_ISSUES.md` | Active blockers that might affect implementation |
| `src/backlog/BACKLOG.md` | Context for the work item |

### Implementation Protocol

1. **Claim the plan** — Add frontmatter `status: in-progress` and `started: <timestamp>` to the plan file
2. **Execute steps sequentially** — Follow the plan's implementation steps in order
3. **Validate after each step** — Run the step's test command if specified
4. **Run acceptance criteria** — Execute every acceptance criterion command
5. **Update plan status** — Set `status: completed` with `completed: <timestamp>` if all criteria pass
6. **Update backlog** — Set backlog item status to `completed`
7. **Handle failures** — If any acceptance criterion fails:
   - Set plan status to `blocked` with `blocked_reason`
   - Do NOT mark backlog item as completed
   - Document the failure in `KNOWN_ISSUES.md` if it's a new issue
   - Write incident note to `docs/agent-handoffs/incidents/`

### Output (Write)

- Modified/created files per the plan
- Updated plan file (status, timestamps)
- Updated backlog (item status)
- Test log in `src/test_logs/TEST_LOG_<timestamp>.md`

### Builder Rules

1. **Follow the plan exactly** — Don't improvise. If the plan says "add line X to file Y", do that
2. **Don't expand scope** — Only make changes listed in the plan. No bonus refactors, no "while I'm here" improvements
3. **Fail loudly** — If a step can't be completed, stop and document why. Don't skip steps
4. **Test everything** — Run every test command in the plan. Run `npm test` and `npm run lint` as final validation
5. **One plan per cycle** — Complete one plan fully before starting another

### Conflict with `feature-proposer-agent`

The existing `feature-proposer-agent` creates single-file features in `features/`. The `builder-agent` executes multi-step plans that may modify existing files. These agents have different scopes:

| Aspect | feature-proposer-agent | builder-agent |
|--------|----------------------|---------------|
| Scope | Single new file in `features/` | Any files specified in plan |
| Input | Own analysis of codebase | Explicit plan from `plan-agent` |
| Modifications | New files only | New + existing files |
| Validation | Self-verified | Acceptance criteria from plan |
| Autonomy | High (chooses what to build) | Low (follows plan exactly) |

Both agents should continue to exist. The `feature-proposer-agent` handles quick, self-contained additions. The `builder-agent` handles planned, multi-step implementations.

---

## Integration with Existing Pipeline

### Roster Changes

Add to `src/prompts/roster.json` under `weekly`:

```json
{
  "weekly": [
    "bug-reproducer-agent",
    "builder-agent",
    "changelog-agent",
    "dead-code-agent",
    "feature-proposer-agent",
    "frontend-console-debug-agent",
    "fuzz-agent",
    "perf-deepdive-agent",
    "perf-optimization-agent",
    "plan-agent",
    "pr-review-agent",
    "prompt-fixer-agent",
    "prompt-gap-analysis-agent",
    "prompt-maintenance-agent",
    "prompt-safety-agent",
    "proposal-triage-agent",
    "race-condition-agent",
    "refactor-agent",
    "repo-fit-agent",
    "smoke-agent",
    "telemetry-agent",
    "test-coverage-agent",
    "ui-ux-agent",
    "weekly-synthesis-agent"
  ]
}
```

### New Directories

```
src/backlog/          # Prioritized implementation backlog (from proposal-triage-agent)
src/plans/            # Implementation plans (from plan-agent)
```

### New Prompt Files

```
src/prompts/weekly/proposal-triage-agent.md
src/prompts/weekly/plan-agent.md
src/prompts/weekly/builder-agent.md
```

### Execution Order Consideration

In the current round-robin, these agents run in alphabetical order within the weekly cadence. The ideal execution order is:

1. `proposal-triage-agent` (produces backlog)
2. `plan-agent` (consumes backlog, produces plan)
3. `builder-agent` (consumes plan, produces implementation)

Since round-robin is alphabetical (`builder-agent` < `plan-agent` < `proposal-triage-agent`), the builder would run *before* the planner in any given week. This is acceptable because:

- Plans persist across weeks — a plan written in week N is built in week N+1
- The pipeline is designed for multi-week cadence, not single-week completion
- Each agent checks for existing artifacts from previous cycles

If same-week execution is desired in the future, the Phase 3+ custom flow configurations from the prompt editor proposal would enable DAG-based ordering.

### Interaction with Existing Agents

| Existing Agent | Interaction |
|---------------|-------------|
| `feature-proposer-agent` | Features it creates may be evaluated by `proposal-triage-agent` |
| `prompt-gap-analysis-agent` | Gap reports feed into `proposal-triage-agent` inputs |
| `weekly-synthesis-agent` | Summarizes triage/plan/build activity in weekly report |
| `governance-agent` | Prompt changes from builder go through normal governance |
| `prompt-maintenance-agent` | Validates new agent prompts follow contract |
| `dead-code-agent` | May identify retired items for triage to confirm |

---

## Addressing the Identified Dead Ends

Here's how the new pipeline would handle each current dead end:

| Dead End | Agent | Action |
|----------|-------|--------|
| Missing `npm run format` | triage → plan → builder | P1: triage identifies, plan writes 2-line change, builder implements |
| Missing `eventSchemas.js` | triage → plan → builder | P1: triage identifies, plan designs extraction, builder creates module |
| content-audit-agent scope | triage | Retired: agent audits nonexistent features |
| Prompt editor Phase 0 | triage → plan | Scoped: triage breaks into sub-tasks, plan designs Phase 0 extraction |
| Prompt packages | triage → plan | Deferred or scoped depending on priority vs. other items |
| Distribution binary | triage | Deferred: requires external tooling, low relative priority |
| 7 coverage gap agents | triage → plan → builder | Each gap becomes a backlog item; plan designs prompt, builder creates it |
| 77 scattered TODOs | triage | Consolidated into backlog; triage replaces scattered TODO creation |
| 130+ dead artifacts | triage | Evaluated for actionability; non-actionable artifacts flagged for GC |

---

## Success Metrics

| Metric | Current | Target (4 weeks) | Target (8 weeks) |
|--------|---------|-------------------|-------------------|
| Stalled proposals | 3 | 2 (1 retired, 1 planned) | 0 (all planned or retired) |
| Broken agents | 3 (event-schema, style, content-audit) | 1 (content-audit retired) | 0 |
| Unimplemented coverage gaps | 7 | 5 (2 planned) | 3 (2 built, 2 planned) |
| Backlog items with clear status | 0 | 10+ | 15+ |
| Plans executed per month | 0 | 2 | 4 |

---

## Implementation Plan for This Proposal

This proposal itself should go through the pipeline it describes. Bootstrap order:

### Step 1: Create directories
```bash
mkdir -p src/backlog src/plans
```

### Step 2: Create `proposal-triage-agent.md`
- Write prompt following shared agent run contract
- Add to `roster.json` weekly array

### Step 3: Create `plan-agent.md`
- Write prompt following shared agent run contract
- Add to `roster.json` weekly array

### Step 4: Create `builder-agent.md`
- Write prompt following shared agent run contract
- Add to `roster.json` weekly array

### Step 5: Seed initial backlog
- Create `src/backlog/BACKLOG.md` with known dead ends pre-triaged
- This gives the plan-agent something to work with on its first run

### Step 6: Validate
- Run `node scripts/validate-prompt-contract.mjs`
- Run `node scripts/validate-scheduler-roster.mjs`
- Run `npm run lint`
- Run `npm test`

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Builder agent makes incorrect changes | High | Plan must have testable acceptance criteria; builder runs all tests |
| Triage agent deprioritizes important work | Medium | Triage criteria are explicit and weighted; human can override backlog |
| Plan scope creep | Medium | Planning rules enforce one plan per cycle, concrete file paths |
| Agents produce circular work (triage creates items that triage later retires) | Low | Retirement rules require 4+ deferred cycles before retirement |
| Builder conflicts with other agents modifying same files | Medium | Lock system prevents concurrent modification; plan specifies exact files |

---

## Relationship to Other Proposals

- **Prompt Editor (Phase 0):** The triage agent would evaluate this proposal and potentially break Phase 0 into backlog items. The plan agent would design the extraction scripts. The builder agent would create them.
- **Prompt Packages:** Same pipeline — triage evaluates, plan designs, builder implements.
- **Distribution Plan:** Triage would likely defer this (requires external tooling) but keep it visible in the backlog.
- **Agent Coverage Gaps:** Each gap becomes a backlog item. The builder agent is literally designed to create new agent prompts from plans.
