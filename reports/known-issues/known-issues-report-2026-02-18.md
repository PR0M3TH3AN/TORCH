# Known Issues Report: 2026-02-18

Headline: ⚠️ active issues remain

## Triage Summary

| Issue | Status | Last Checked | Notes |
| :--- | :--- | :--- | :--- |
| Goose Desktop: hermit "text file busy" | Active | 2026-02-15 | Skipped (Environment specific) |
| Goose Desktop: `node`/`npx` wrappers swallow exit codes | Active | 2026-02-15 | Skipped (Environment specific) |
| `npm test` fails due to prompt contract violations | **Resolved** | 2026-02-18 | Verified via `npm run validate:scheduler` (passed). |
| `npm test` hangs/times out in full suite run | Active | 2026-02-16 | Not verified this run. |
| Recurring scheduler lock backend failures | Monitoring | 2026-02-15 | No new failures observed during this run. |
| `content-audit-agent` targets missing `/content` directory | **Resolved** | 2026-02-18 | Fixed `src/prompts/daily/content-audit-agent.md` to reference `docs/` instead of `/content`. |

## Actions Taken

1.  **Verified** `npm test` prompt contract violations are resolved by running `npm run validate:scheduler`.
2.  **Fixed** `content-audit-agent` target directory issue by updating `src/prompts/daily/content-audit-agent.md` to point to `docs/` (the existing content directory) instead of the non-existent `/content`.

## Blockers

- Goose Desktop issues cannot be verified in this environment.
- `npm test` timeout requires investigation into test suite performance.
