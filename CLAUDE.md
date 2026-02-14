# CLAUDE.md — Generic Agent Execution Workflow

This guide defines an execution flow that works across repositories and tech stacks.

## Default workflow

1. **Load baseline context**
   - `AGENTS.md`
   - `CONTRIBUTING.md`
   - `KNOWN_ISSUES.md`
   - `docs/agent-handoffs/README.md`
   - Recent notes in `docs/agent-handoffs/learnings/` and `docs/agent-handoffs/incidents/`
2. **Clarify the task**
   - Restate the requested outcome.
   - Identify constraints, risks, and assumptions.
3. **Plan minimal changes**
   - Keep scope tight.
   - Avoid touching unrelated files.
4. **Implement**
   - Apply small, reversible edits.
   - Favor readability and maintainability.
5. **Validate**
   - Run relevant checks for impacted files.
   - Capture exact commands and outcomes.
6. **Document and hand off**
   - Summarize what changed and why.
   - Record reusable learnings/incidents when appropriate.

## Working files for session state

Use the following folders as lightweight coordination artifacts:

- `src/context/` — Current objective, scope, constraints.
- `src/todo/` — Task checklist and blockers.
- `src/decisions/` — Important design/implementation choices.
- `src/test_logs/` — Validation commands and results.
- `src/issues/` — Investigations or audits that may become tracked issues.

### Recommended content templates

#### Context note template

- Goal
- Scope
- Constraints
- Open questions

#### Todo note template

- Pending tasks
- Completed tasks
- Blocked tasks

#### Decision note template

- Decision
- Alternatives considered
- Rationale
- Consequences/follow-ups

#### Test log template

- Command
- Result (pass/fail/warn)
- Notes (environmental limits, retries, artifacts)

## Knowledge-sharing protocol

### Where to write durable knowledge

- `docs/agent-handoffs/learnings/` for reusable successes.
- `docs/agent-handoffs/incidents/` for failures and mitigations.
- `KNOWN_ISSUES.md` for active, reproducible unresolved issues.

### File naming

Use `YYYY-MM-DD-short-topic.md`.

### Required structure for learning/incident notes

1. Context
2. Observation
3. Action taken
4. Validation performed
5. Recommendation for next agents

## Quality checklist before completion

- Scope matches request.
- Documentation remains repository-agnostic unless explicitly needed.
- No unsupported claims about testing.
- Assumptions and limitations are called out.
- Changes are easy to revert.

## Anti-patterns to avoid

- Embedding product/company-specific guidance in baseline docs.
- Large refactors when a focused change is sufficient.
- Skipping validation without recording why.
- Creating duplicate notes when an update would suffice.

## Customization policy

This file should stay generic until real repository-specific patterns emerge. When customizing:

- Add a clearly labeled section: `Repository-specific overrides`.
- Keep generic workflow unchanged.
- Include evidence (commands, failures, repeated incidents) for each override.
