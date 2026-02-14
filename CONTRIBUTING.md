# CONTRIBUTING.md

Guidelines for humans and agents proposing changes.

## Change principles

- Keep changes focused and minimal.
- Explain why the change is needed, not only what changed.
- Preserve generic behavior unless explicit repository-specific behavior is required.

## Before opening a PR

1. Confirm `AGENTS.md` and `CLAUDE.md` were followed.
2. Run relevant checks/tests for the changed scope.
3. Update documentation impacted by behavior or workflow changes.
4. If reusable knowledge was discovered, update/add a note in `docs/agent-handoffs/`.
5. If an issue remains active, update `KNOWN_ISSUES.md`.

## Commit guidance

- Use clear, descriptive commit messages.
- Keep unrelated edits in separate commits.
- Do not commit temporary debug code, generated noise, or local-only artifacts.

## PR guidance

Include:

- What changed
- Why it changed
- Validation performed
- Follow-up items or risks

If no tests/checks were run, explicitly state why.

## Agent handoff expectations

When your work creates reusable context:

- Prefer updating an existing handoff note over creating duplicates.
- If creating a new note, use `YYYY-MM-DD-short-topic.md`.
- Keep notes generic and actionable.
- Use the required sections from `docs/agent-handoffs/README.md`.

## Documentation maintenance

When workflows change:

- Update `KNOWN_ISSUES.md` for newly discovered active limitations/workarounds.
- Add/update a learning or incident note for durable guidance.
