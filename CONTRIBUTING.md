# CONTRIBUTING.md — Generic Collaboration Guide

This repository is designed for human and AI contributors. Keep contributions small, clear, and verifiable.

## Contribution principles

- Prefer focused pull requests.
- Avoid unrelated refactors.
- Preserve existing behavior unless a change is explicitly requested.
- Document assumptions and tradeoffs.

## Standard contribution flow

1. Sync your branch with the target base branch.
2. Read baseline guidance:
   - `AGENTS.md`
   - `CLAUDE.md`
   - `KNOWN_ISSUES.md`
3. Implement minimal changes required to solve the task.
4. Run relevant validation checks.
5. Update documentation if behavior or workflow changed.
6. Commit with a clear message.
7. Open a PR with complete context.

## Commit expectations

- Keep commits atomic and descriptive.
- Use imperative commit subjects.
- Separate mechanical renames from behavioral changes when possible.

## Pull request expectations

Each PR should include:

- **Summary**: what changed.
- **Why**: motivation/problem solved.
- **Files modified**: key files touched.
- **Validation**: exact commands run and outcomes.
- **Risks / rollback**: known risks and how to revert.

## Validation expectations

- Run checks most relevant to changed files (tests, lint, typecheck, build, scripts).
- If a check cannot run, include:
  - command attempted,
  - reason it failed or was unavailable,
  - fallback verification performed.

## Documentation and handoffs

When your work creates reusable knowledge:

- Add/update `docs/agent-handoffs/learnings/` for successful patterns.
- Add/update `docs/agent-handoffs/incidents/` for failure modes and mitigations.
- Add/update `KNOWN_ISSUES.md` for active unresolved issues.

Use filename format: `YYYY-MM-DD-short-topic.md`.

## Security and privacy

- Never commit credentials, tokens, secrets, or personal data.
- Redact sensitive values in logs and examples.
- Prefer synthetic or anonymized examples in documentation.
