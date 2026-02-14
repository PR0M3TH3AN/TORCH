# AGENTS.md

Repository-wide instructions for any autonomous or semi-autonomous coding agent.

## Purpose

This repository is intended to be reusable across many projects. Keep changes and documentation generic unless you are actively working inside a specific downstream repo that requires project-specific customization.

## Startup checklist (every run)

1. Read this file (`AGENTS.md`).
2. Read `CLAUDE.md` for operating conventions.
3. Read `CONTRIBUTING.md` for commit/PR quality expectations.
4. Check `KNOWN_ISSUES.md` before making changes.
5. If present, check `docs/agent-handoffs/` for recent agent learnings.

## Generic-first policy

- Do not hardcode organization, product, customer, or brand-specific details.
- Do not assume a single deployment environment unless explicitly configured.
- Prefer neutral names such as `project`, `service`, `integration`, `consumer`, `provider`.
- Add project-specific notes only when working in that project's repo and label them clearly.

## Agent learning + handoff protocol

Agents are expected to leave concise, reusable notes for later agents.

### Where to write

- `docs/agent-handoffs/README.md` for folder usage.
- `docs/agent-handoffs/learnings/` for new practical learnings.
- `docs/agent-handoffs/incidents/` for issue/incident writeups and mitigations.

### Naming convention

Use generic, descriptive filenames:

- `YYYY-MM-DD-short-topic.md` (example: `2026-02-14-lock-timeout-tuning.md`)

Avoid brand, team, or person-specific prefixes in filenames.

### Required note structure

Each note should contain:

- Context
- Observation
- Action taken
- Validation performed
- Recommendation for next agents

Keep each note short and actionable.

## Safety and quality baseline

- Make smallest safe change first.
- Prefer explicit commands over assumptions.
- Validate with available tests/checks.
- If blocked by environment limits, document the blocker and fallback.

## Priority order

When instructions conflict, follow this order:

1. System/developer/user instructions in-session
2. `AGENTS.md`
3. `CLAUDE.md`
4. `CONTRIBUTING.md`
5. Inline comments and prompt files
