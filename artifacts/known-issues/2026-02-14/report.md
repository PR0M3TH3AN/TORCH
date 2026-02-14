# Daily Remediation Report - 2026-02-14

## Summary
- **Status:** ⚠️ Active issues remain
- **Verified:** 0 existing issues (KNOWN_ISSUES.md was empty).
- **New Issues:** 1 found.

## Issues Found
1. **`npm test` fails due to prompt contract violations**:
   - `npm test` runs `npm run validate:scheduler`, which flags multiple agents for missing `lock:complete` tokens.
   - `known-issues-agent` also failed validation.
   - Added to `KNOWN_ISSUES.md`.

## Actions
- Updated `KNOWN_ISSUES.md` with the new issue.
