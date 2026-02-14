# AGENTS.md — Repository-Agnostic Agent Operating Guide

This file defines how agents should work in this repository **before any project-specific customization exists**.

## Purpose

- Keep agent work predictable, auditable, and safe.
- Minimize repeated discovery work across sessions.
- Capture durable learnings so future agents can move faster.

## Session startup checklist (run every session)

1. Read `AGENTS.md`.
2. Read `CLAUDE.md` for execution workflow details.
3. Read `CONTRIBUTING.md` for commit and PR expectations.
4. Read `KNOWN_ISSUES.md` for active blockers and workarounds.
5. Read `docs/agent-handoffs/README.md`.
6. Scan recent notes in:
   - `docs/agent-handoffs/learnings/`
   - `docs/agent-handoffs/incidents/`
7. If present, review the current run artifacts in:
   - `src/context/`
   - `src/todo/`
   - `src/decisions/`
   - `src/test_logs/`
   - `src/issues/`

## Core operating principles

- Default to generic guidance and neutral language.
- Make the smallest safe change that satisfies the request.
- Avoid unrelated refactors.
- Preserve backward compatibility unless explicitly asked otherwise.
- Prefer explicit commands and documented behavior over assumptions.
- Record assumptions clearly in your final summary.

## Validation policy

- Run the most relevant checks for changed files (tests, lint, typecheck, build, or targeted scripts).
- Never claim a check passed unless it was actually executed.
- If a check cannot run, record:
  - command attempted,
  - why it could not complete,
  - what fallback validation was performed.

## Knowledge-sharing protocol

### What belongs where

- `KNOWN_ISSUES.md`
  - Active, reproducible issues only.
  - Include status, impact, workaround, and last verification date.
- `docs/agent-handoffs/learnings/`
  - Proven patterns, repeatable fixes, and successful implementation guidance.
- `docs/agent-handoffs/incidents/`
  - Failures, root causes, mitigations, and prevention guidance.
- `src/context/`
  - Snapshot of current task context (goal, scope, constraints).
- `src/todo/`
  - Actionable checklist for in-progress work.
- `src/decisions/`
  - Key implementation decisions and rationale.
- `src/test_logs/`
  - Commands run and their outcomes.
- `src/issues/`
  - One-off investigative or audit outputs not yet promoted to `KNOWN_ISSUES.md`.

### Naming standard (generic)

Use: `YYYY-MM-DD-short-topic.md`

Examples:

- `2026-02-14-validation-before-summary.md`
- `2026-02-14-missing-baseline-context.md`

Naming rules:

- Keep names concise and descriptive.
- Avoid company, product, team, customer, and environment names.
- Prefer neutral technical terms.

### Required sections for reusable notes

Use these headings in learning/incident notes:

1. Context
2. Observation
3. Action taken
4. Validation performed
5. Recommendation for next agents

### Update decision tree

When you discover reusable context:

1. Check if an existing note already covers it.
2. If yes, update that note.
3. If no, add a new note in `learnings/` or `incidents/`.
4. If the issue is still active/reproducible, add or update `KNOWN_ISSUES.md`.

## Priority order when guidance conflicts

1. System/developer/user instructions in the active session
2. `AGENTS.md`
3. `CLAUDE.md`
4. `CONTRIBUTING.md`
5. Inline code comments and prompt templates

## Keep this file generic

Only add project-specific details after they are truly needed and explicitly labeled as repository-specific.
