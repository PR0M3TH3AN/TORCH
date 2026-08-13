# Conventions

Validated conventions not obvious from the code.

## Report Location Standard: no root clutter

All agent-generated reports go under `reports/<category>/` (audit,
performance, security, test-audit, weekly-synthesis, etc.); `*.log`, `*.txt`,
`*.json`, and `*.md` files are prohibited in the repo root except the standard
docs (README.md, AGENTS.md, CLAUDE.md, KNOWN_ISSUES.md). If a tool defaults to
writing at the root, redirect its output. The `.gitignore` "Root clutter
prevention" block backs the same rule.

Authoritative source:
- AGENTS.md (§Report Location Standard)
- .gitignore
