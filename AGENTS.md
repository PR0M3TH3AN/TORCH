# AGENTS.md

Repository-wide operating instructions for autonomous and semi-autonomous coding agents.

## Goal

Keep this repository reusable across many downstream projects. Favor generic defaults, portable workflows, and minimal assumptions so the same guidance works in different stacks and environments.

## Session startup checklist

Run this checklist at the beginning of every session:

1. Read `AGENTS.md` (this file).
2. Read `CLAUDE.md` for execution workflow and handoff rules.
3. Read `CONTRIBUTING.md` for commit and pull request expectations.
4. Read `KNOWN_ISSUES.md` for active blockers and workarounds.
5. Review `docs/agent-handoffs/README.md` and recent notes in:
   - `docs/agent-handoffs/learnings/`
   - `docs/agent-handoffs/incidents/`

## Repo-agnostic defaults

- Do not hardcode company, product, customer, environment, or team-specific details.
- Prefer neutral terms such as `project`, `service`, `consumer`, `provider`, `integration`, and `environment`.
- Avoid assumptions about deployment target (local, cloud, CI, container) unless explicitly configured.
- Add project-specific details only when required by the current repository and clearly label them as such.

## Decision and implementation policy

- Start with the smallest safe change that solves the user request.
- Prefer explicit commands over implied behavior.
- Keep edits focused; avoid unrelated refactors.
- Preserve backward compatibility unless the task explicitly allows breaking changes.
- If uncertainty remains, document assumptions in the final summary.

## Validation baseline

- Run the most relevant checks for changed files (tests, lint, typecheck, build, or targeted scripts).
- If a check cannot run due to environment limits, record:
  - what was attempted,
  - why it could not run,
  - what fallback validation was done.
- Never claim a check passed if it was not executed.

## Agent handoff protocol

Capture reusable context so future agents can continue without rediscovery.

### Where to record information

- `KNOWN_ISSUES.md`: active/reproducible issues, current status, impact, and workarounds.
- `docs/agent-handoffs/learnings/`: successful patterns or repeatable fixes.
- `docs/agent-handoffs/incidents/`: failures, root causes, and mitigations.

### Note naming

Use generic, descriptive filenames:

- `YYYY-MM-DD-short-topic.md`

### Required note sections

Every new learning/incident note should include:

- Context
- Observation
- Action taken
- Validation performed
- Recommendation for next agents

## Priority order for conflicting instructions

1. System/developer/user instructions in the active session
2. `AGENTS.md`
3. `CLAUDE.md`
4. `CONTRIBUTING.md`
5. Inline comments and prompt templates
