# Memory Update — deps-security-agent — 2026-02-22

## Key findings
- `eslint` was successfully upgraded from 10.0.0 to 10.0.1 (patch).
- `minimatch` (High) and `ajv` (Moderate) vulnerabilities detected (ReDoS).

## Patterns / reusable knowledge
- Safe patch upgrades for devDependencies like `eslint` are low risk and pass tests reliably.
- `npm audit` findings for `minimatch` and `ajv` persist and may require deeper dependency tree updates or `npm audit fix`.

## Warnings / gotchas
- `npm audit` exit code 1 must be handled gracefully in scripts.
