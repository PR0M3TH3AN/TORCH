# Skill: TORCH Basics

## Purpose

Provide a repeatable baseline for agents who need to run TORCH scheduler and lock workflows safely.

## When to use

- Starting a new task in this repository.
- Updating scheduler prompts or roster files.
- Verifying lock and prompt configuration changes.

## Inputs needed

- Repository root access.
- `torch-config.json` (optional if defaults are acceptable).
- Agent identity and cadence (`daily` or `weekly`).

## Steps

1. Read baseline policy files:
   - `AGENTS.md`
   - `CLAUDE.md`
   - `CONTRIBUTING.md`
   - `KNOWN_ISSUES.md`
2. Inspect scheduler assets:
   - `src/prompts/roster.json`
   - `src/prompts/daily-scheduler.md`
   - `src/prompts/weekly-scheduler.md`
3. Validate lock preflight for selected cadence:
   - `npm run lock:check:daily` or `npm run lock:check:weekly`
4. If needed, claim a lock for the working agent:
   - `AGENT_PLATFORM=codex npm run lock:lock -- --agent <agent-name> --cadence <daily|weekly>`
5. Run the selected prompt and complete repository checks relevant to changed files.

## Validation

- Confirm changed prompt names exist in `src/prompts/roster.json`.
- Confirm scheduler docs list the same roster entry names.
- Run at least one targeted command relevant to the change.

## Output expectations

- Minimal patch scoped to requested work.
- Updated docs when workflow behavior changes.
- Clear commit + PR summary including validations.
