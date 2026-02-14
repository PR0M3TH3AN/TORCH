# CLAUDE.md

Operational playbook for agent execution in this repository.

## Scope

Applies to all agent tasks unless superseded by direct runtime instructions.

## Operating model

- Keep output and changes generic by default.
- Prefer deterministic, auditable steps.
- Record useful decisions so future agents can continue with minimal rediscovery.

## Execution flow (recommended)

1. Read policy files listed in `AGENTS.md` startup checklist.
2. Review current known issues and recent handoff notes.
3. Implement the smallest safe change.
4. Validate with relevant checks/tests.
5. Update shared docs (`KNOWN_ISSUES.md` and/or handoff notes) when new reusable knowledge appears.

## Handoff documentation workflow

When you learn something that can help future agents:

1. Check for related notes in:
   - `docs/agent-handoffs/learnings/`
   - `docs/agent-handoffs/incidents/`
2. If the insight is new, add a short markdown note using the naming standard from `AGENTS.md`.
3. If the issue is still active/reproducible, add or update the corresponding entry in `KNOWN_ISSUES.md`.
4. Keep note content sanitized and reusable (no secrets, no user-identifying details).

## What belongs where

- `KNOWN_ISSUES.md`: active/reproducible issues, impact, workaround, and current status.
- `docs/agent-handoffs/learnings/`: durable implementation insights and successful patterns.
- `docs/agent-handoffs/incidents/`: failure writeups, root causes, and prevention guidance.
- `CONTRIBUTING.md`: standards for proposing, validating, and reviewing changes.

## Style for handoff notes

- Prefer bullets over long prose.
- Include exact commands where useful.
- State confidence and remaining uncertainty.
- End with: `Recommendation for next agents:`

## Anti-patterns

- Avoid repo-local jargon in reusable templates.
- Avoid stale TODO dumps without context.
- Avoid project/brand-specific terms unless explicitly required by the active downstream repo.
