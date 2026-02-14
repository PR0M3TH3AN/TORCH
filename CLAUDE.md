# CLAUDE.md

Execution playbook for agents working in this repository.

## Scope

Applies to all tasks unless overridden by direct session instructions.

## Core operating principles

- Be repository-agnostic by default.
- Keep behavior deterministic and auditable.
- Prefer minimal, reversible changes.
- Leave the workspace clearer for the next agent than you found it.

## Recommended execution workflow

1. Load baseline context from `AGENTS.md`, `CONTRIBUTING.md`, `KNOWN_ISSUES.md`, and handoff notes.
2. Restate the task internally as concrete outcomes.
3. Make the smallest safe implementation change.
4. Validate with the most relevant automated checks available.
5. Summarize results with clear evidence (commands, outputs, and file references).
6. Record durable learnings/incidents if new reusable knowledge was discovered.

## Change quality checklist

Before finishing, verify:

- The change is scoped to the request.
- Naming and docs remain generic unless project-specific behavior is explicitly required.
- Existing workflows are not silently broken.
- Validation matches the risk level of the change.

## Handoff and documentation expectations

When new reusable context appears:

1. Search for an existing related note in:
   - `docs/agent-handoffs/learnings/`
   - `docs/agent-handoffs/incidents/`
2. Update existing notes if they already cover the issue.
3. Otherwise add a new note using `YYYY-MM-DD-short-topic.md`.
4. If the issue is still active/reproducible, add or update `KNOWN_ISSUES.md`.

Keep notes concise, actionable, and safe to share.

## What belongs where

- `KNOWN_ISSUES.md`: active issues, impact, status, workaround, verification date.
- `docs/agent-handoffs/learnings/`: successful implementation patterns.
- `docs/agent-handoffs/incidents/`: failures and prevention guidance.
- `CONTRIBUTING.md`: contribution, review, and quality standards.

## Writing style for handoff notes

- Prefer bullets over long prose.
- Include exact commands when they improve reproducibility.
- Explicitly separate facts from assumptions.
- End with: `Recommendation for next agents:`

## Anti-patterns to avoid

- Product/brand-specific assumptions in reusable docs.
- Broad refactors not required for the current request.
- Status updates without validation evidence.
- Duplicated notes that fragment context.
