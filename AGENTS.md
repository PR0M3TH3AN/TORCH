# AGENTS.md

Repository-wide operating instructions for autonomous and semi-autonomous coding agents.

## Goal

Make this repository portable across many downstream projects. Default to generic guidance, minimal assumptions, and workflows that work in different languages, runtimes, and deployment environments.

## Session startup checklist (run every session)

1. Read `AGENTS.md` (this file).
2. Read `CLAUDE.md` for execution workflow and handoff protocol details.
3. Read `CONTRIBUTING.md` for commit/PR expectations.
4. Read `KNOWN_ISSUES.md` for active blockers and workarounds.
5. Read `docs/agent-handoffs/README.md`.
6. Review recent notes in:
   - `docs/agent-handoffs/learnings/`
   - `docs/agent-handoffs/incidents/`

## Repo-agnostic defaults

- Do not hardcode company, product, team, customer, or environment-specific assumptions.
- Prefer neutral terms such as `project`, `service`, `integration`, `consumer`, `provider`, and `environment`.
- Do not assume a specific infrastructure model (local machine, container, CI, cloud VM, etc.) unless explicitly configured in repo files.
- Add project-specific details only when required by the current repository and clearly label them as repository-specific.

## Decision and implementation policy

- Start with the smallest safe change that satisfies the request.
- Keep edits focused; avoid unrelated refactors.
- Prefer explicit commands and documented behavior over implicit assumptions.
- Preserve backward compatibility unless the task explicitly permits a breaking change.
- If assumptions are necessary, record them in the final summary.

## Validation baseline

- Run the most relevant checks for changed files (tests, lint, typecheck, build, or targeted scripts).
- If a check cannot run, record:
  - command attempted,
  - reason it could not complete,
  - fallback validation performed.
- Never claim a check passed unless it was actually executed.

## Agent knowledge-sharing protocol

Capture reusable context so future agents can continue without rediscovery.

### What belongs where

- `KNOWN_ISSUES.md`
  - Active and reproducible issues only.
  - Include status, impact, workaround, and last verification date.
- `docs/agent-handoffs/learnings/`
  - Proven patterns, repeatable fixes, and successful implementation guidance.
- `docs/agent-handoffs/incidents/`
  - Failures, root causes, mitigations, and prevention guidance.

### File naming standard (generic)

Use descriptive, repository-agnostic note names:

- `YYYY-MM-DD-short-topic.md`

Good examples:

- `2026-02-14-validation-before-summary.md`
- `2026-02-14-missing-baseline-context.md`

Avoid tool, product, customer, or team names in filenames unless absolutely required for clarity.

### Required note sections

Every learning or incident note should include these headings:

1. Context
2. Observation
3. Action taken
4. Validation performed
5. Recommendation for next agents

### Update decision tree

When you discover new reusable context:

1. Check if an existing note already covers it.
2. If yes, update the existing note.
3. If no, add a new note in `learnings/` or `incidents/` using the naming standard above.
4. If the issue is still active/reproducible, add or update an entry in `KNOWN_ISSUES.md`.

## Priority order for conflicting instructions

1. System/developer/user instructions in the active session
2. `AGENTS.md`
3. `CLAUDE.md`
4. `CONTRIBUTING.md`
5. Inline code comments and prompt templates
