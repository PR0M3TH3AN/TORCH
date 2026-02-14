# CLAUDE.md

Operational playbook for agent execution in this repository.

## Scope

Applies to all agent tasks unless superseded by direct runtime instructions.

## Operating model

- Keep output and changes generic by default.
- Prefer deterministic, auditable steps.
- Record decisions so future agents can continue with minimal rediscovery.

## Handoff documentation workflow

When you learn something that can help future agents:

1. Check for existing related notes in `docs/agent-handoffs/learnings/` and `docs/agent-handoffs/incidents/`.
2. If the learning is new, add a small markdown note using the naming standard in `AGENTS.md`.
3. Link related issue patterns in `KNOWN_ISSUES.md` when applicable.
4. Keep note content sanitized and reusable (no secrets, no user-identifying details).

## What belongs where

- `KNOWN_ISSUES.md`: currently active/reproducible issues and known workarounds.
- `docs/agent-handoffs/learnings/`: durable implementation insights and successful patterns.
- `docs/agent-handoffs/incidents/`: failure reports, root-cause notes, and prevention guidance.
- `CONTRIBUTING.md`: process standards for proposing and reviewing changes.

## Style for agent notes

- Prefer bullets over long prose.
- Include exact commands where useful.
- State confidence and remaining uncertainty.
- End with a “Next agent should …” line.

## Anti-patterns

- Avoid repo-local jargon in shared templates.
- Avoid stale TODO dumps without context or owner.
- Avoid project/brand-specific terms unless explicitly required by the active repo.
