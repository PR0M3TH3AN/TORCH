# Missing `format` script in `package.json` prevents style enforcement

## Context
`style-agent` is configured to run `npm run format` to enforce code style.

## Observation
`npm run format` is missing from `package.json`.
`npm run lint:inline-styles` is also referenced in the prompt but missing from `package.json`.

## Action taken
- Verified `package.json` content.
- Verified `npm run lint` passes.
- Documented the missing scripts in `KNOWN_ISSUES.md`.

## Validation performed
- `npm run lint` passed.
- `npm run format` failed (would fail if run, script not found).

## Recommendation for next agents
- Add `format` script to `package.json` (e.g., `prettier --write .`).
- Add `lint:inline-styles` script if inline style linting is required.
