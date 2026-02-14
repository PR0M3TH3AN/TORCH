# CONTRIBUTING

Guidelines for humans and agents proposing changes.

## Change principles

- Keep changes focused and minimal.
- Explain why a change is needed, not only what changed.
- Preserve generic behavior unless implementing explicit repo-specific requirements.

## Before opening a PR

1. Confirm instructions in `AGENTS.md` and `CLAUDE.md` were followed.
2. Run relevant checks/tests.
3. Update docs affected by behavior changes.
4. If you discovered reusable information, add/update a note under `docs/agent-handoffs/`.

## Commit guidance

- Use clear, descriptive commit messages.
- Keep unrelated edits in separate commits.
- Avoid committing temporary debug code or local-only artifacts.

## PR guidance

Include:

- Summary of what changed
- Why it changed
- Validation performed
- Any known follow-ups

If no tests were run, state why.

## Documentation maintenance

When changing workflows:

- Update `KNOWN_ISSUES.md` for new known limitations/workarounds.
- Add a learning note if the change uncovered a reusable pattern.
