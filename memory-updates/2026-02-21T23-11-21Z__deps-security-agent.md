# Memory Update — deps-security-agent — 2026-02-21

## Key findings
- Upgraded `eslint` from `10.0.0` to `10.0.1`.
- Found transitive high-severity vulnerability in `minimatch`. Added to `KNOWN_ISSUES.md`.
- `ajv` moderate vulnerability persists.

## Patterns / reusable knowledge
- Always check `npm audit` details for transitive path.
- `minimatch` ReDoS is a recurring issue in older trees.

## Warnings / gotchas
- `npm audit` exits non-zero; handle gracefully in scripts.
