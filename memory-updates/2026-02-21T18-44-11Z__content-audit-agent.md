# Memory Update — content-audit-agent — 2026-02-21

## Key findings
- CLI help text (`USAGE_TEXT`) can drift from implementation (`src/lib.mjs`) if not actively audited.
- `package.json` scripts do not cover all `torch-lock` CLI commands (e.g. `proposal`, `rollback`, `backup`).

## Patterns / reusable knowledge
- Always cross-reference `bin/torch-lock.mjs --help` against `README.md` and `src/lib.mjs` command handlers.

## Warnings / gotchas
- `npm run validate:docs` only checks links, not command accuracy or completeness.
