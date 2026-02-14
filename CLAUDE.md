# CLAUDE.md

Execution playbook for agents working in this repository.

## Scope

Applies to all tasks unless direct session instructions override it.

## Operating principles

- Be repository-agnostic by default.
- Make deterministic, auditable decisions.
- Prefer minimal, reversible changes.
- Leave clearer context for the next agent.

## Standard execution workflow

1. Load baseline context:
   - `AGENTS.md`
   - `CONTRIBUTING.md`
   - `KNOWN_ISSUES.md`
   - `docs/agent-handoffs/README.md`
   - recent notes in `docs/agent-handoffs/learnings/` and `docs/agent-handoffs/incidents/`
2. Translate the request into concrete outcomes.
3. Implement the smallest safe change.
4. Run relevant validation.
5. Summarize evidence clearly (commands, outputs, and changed files).
6. Record durable learnings/incidents when new reusable knowledge appears.

## Quality checklist before finishing

- Scope matches the user request.
- Language and guidance remain generic unless project-specific detail is required.
- Existing workflows were not unintentionally broken.
- Validation coverage is appropriate for risk/impact.

## Knowledge-sharing and handoff protocol

### 1) Search first

Before writing a new note, check for an existing related note and update it if applicable.

### 2) Write in the right place

- `docs/agent-handoffs/learnings/` for successful patterns.
- `docs/agent-handoffs/incidents/` for failures and mitigations.

### 3) Use generic, consistent names

- Format: `YYYY-MM-DD-short-topic.md`
- Keep names descriptive and repository-agnostic.

### 4) Use the required structure

Each note should include:

- Context
- Observation
- Action taken
- Validation performed
- Recommendation for next agents

### 5) Promote active problems to `KNOWN_ISSUES.md`

If the problem is still reproducible or unresolved, add/update a `KNOWN_ISSUES.md` entry with status, impact, workaround, and last verified date.

## What belongs where

- `KNOWN_ISSUES.md`: currently active issues and workarounds.
- `docs/agent-handoffs/learnings/`: reusable successes.
- `docs/agent-handoffs/incidents/`: reusable failure analysis.
- `CONTRIBUTING.md`: expectations for commits, PRs, and validation.

## Writing style for agent notes

- Prefer concise bullets over long prose.
- Include exact commands when they improve reproducibility.
- Clearly separate facts from assumptions.
- End with a practical recommendation for the next agent.

## Anti-patterns

- Project/brand-specific assumptions in reusable docs.
- Unnecessary broad refactors.
- Claims of validation without executed checks.
- Duplicate notes that fragment context across many files.
