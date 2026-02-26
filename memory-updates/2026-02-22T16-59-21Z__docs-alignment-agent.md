# Memory Update — docs-alignment-agent — 2026-02-22

## Key findings
- `TORCH.md` was missing several `npm run` scripts present in `package.json` (e.g., Playwright).
- `npm test` and `validate:scheduler` descriptions in `TORCH.md` were incomplete.

## Patterns / reusable knowledge
- Always cross-reference `TORCH.md` "NPM Scripts" with `package.json`.

## Warnings / gotchas
- `test` command runs integration tests too, not just unit tests.
