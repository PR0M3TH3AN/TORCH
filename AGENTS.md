# AGENTS.md

Repository-wide instructions for any autonomous or semi-autonomous coding agent.

## Purpose

This repository is designed to be reused across many downstream projects. Keep behavior, docs, and naming generic by default unless you are actively working inside a specific downstream repo that requires explicit customization.

## Startup checklist (run every session)

1. Read this file (`AGENTS.md`).
2. Read `CLAUDE.md` for execution conventions.
3. Read `CONTRIBUTING.md` for commit/PR expectations.
4. Check `KNOWN_ISSUES.md` for active blockers or workarounds.
5. Review `docs/agent-handoffs/README.md` and recent notes in:
   - `docs/agent-handoffs/learnings/`
   - `docs/agent-handoffs/incidents/`

## Generic-first policy

- Do not hardcode organization, product, customer, or brand-specific details.
- Do not assume a single deployment environment unless explicitly configured.
- Prefer neutral names such as `project`, `service`, `integration`, `consumer`, `provider`.
- Add project-specific notes only when working in that project’s own repository, and label them clearly.

## Agent learning + handoff protocol

Agents are expected to leave concise, reusable notes so future agents do not need to rediscover the same context.

### Which file should be updated?

- Update `KNOWN_ISSUES.md` when an issue is active/reproducible and others may hit it.
- Add a file in `docs/agent-handoffs/learnings/` for reusable successful patterns.
- Add a file in `docs/agent-handoffs/incidents/` for failures, root cause, and mitigations.

### Naming convention

Use generic, descriptive filenames:

- `YYYY-MM-DD-short-topic.md` (example: `2026-02-14-lock-timeout-tuning.md`)

Avoid product, team, or person-specific prefixes.

### Required note structure

Each learning/incident note should include:

- Context
- Observation
- Action taken
- Validation performed
- Recommendation for next agents

Keep each note short, actionable, and safe to share (no secrets).

### When to write a note

Write or update a handoff note when you discover:

- A non-obvious fix or command sequence that works reliably.
- A recurring failure mode and how to prevent it.
- A validation step that catches common mistakes early.

## Safety and quality baseline

- Make the smallest safe change first.
- Prefer explicit commands over assumptions.
- Validate with relevant tests/checks.
- If blocked by environment limits, record the blocker and fallback.

## Priority order

When instructions conflict, follow this order:

1. System/developer/user instructions in-session
2. `AGENTS.md`
3. `CLAUDE.md`
4. `CONTRIBUTING.md`
5. Inline comments and prompt files
