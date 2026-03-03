---
agent: docs-code-investigator
cadence: daily
run-start: 2026-03-03T01:00:00Z
prompt-path: src/prompts/daily/docs-code-investigator.md
---
# DECISIONS

## Decision: `dashboard/app.js` Focus
### Rationale:
Using `git ls-files | xargs wc -l | sort -rn`, `dashboard/app.js` is the largest Javascript file in the codebase (835 lines) mapping directly to a specific un-tested surface (the user-facing frontend dashboard), making it a prime candidate for `docs-code-investigator`.

## Decision: JSDoc vs Inline
### Rationale:
The instructions enforce JSDocs for public exports or major functional block entrypoints. By assigning JSDocs specifically to async state loading functions (`bootstrap()`, `fetchDocs()`) and connection functions (`connectToRelay()`), we document the most complex and critical paths without polluting smaller DOM event handlers.