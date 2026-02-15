
# Onboarding Audit Report

**Date:** 2026-02-15T01:03:31Z
**Agent:** onboarding-audit-agent

## Summary
⚠️ Onboarding failures found.

## Environment
- OS: Linux (Sandbox)
- Node: v22.22.0

## Steps Executed
1. `npm ci` - Passed
2. `npm test` - Failed
3. `npm run lint` - Passed (with warnings)

## Failures
### npm test
The test suite failed due to `validate-prompt-contract.mjs` errors. Many prompt files are missing required contract tokens (e.g., `lock:complete`, `_completed.md`).

**Log Excerpt:**
```
- [prompt-contract] src/prompts/weekly/refactor-agent.md: missing contract token in required section: `*_failed.md`
- [prompt-contract] src/prompts/weekly/repo-fit-agent.md: missing contract token in required section: `npm run lock:complete -- --agent <agent-name> --cadence <cadence>`
- [prompt-contract] src/prompts/weekly/repo-fit-agent.md: missing contract token in required section: `*_completed.md`
- [prompt-contract] src/prompts/weekly/repo-fit-agent.md: missing contract token in required section: `*_failed.md`
- [prompt-contract] src/prompts/weekly/smoke-agent.md: missing contract token in required section: `npm run lock:complete -- --agent <agent-name> --cadence <cadence>`
- [prompt-contract] src/prompts/weekly/smoke-agent.md: missing contract token in required section: `*_completed.md`
- [prompt-contract] src/prompts/weekly/smoke-agent.md: missing contract token in required section: `*_failed.md`
- [prompt-contract] src/prompts/weekly/telemetry-agent.md: missing contract token in required section: `npm run lock:complete -- --agent <agent-name> --cadence <cadence>`
- [prompt-contract] src/prompts/weekly/telemetry-agent.md: missing contract token in required section: `*_completed.md`
- [prompt-contract] src/prompts/weekly/telemetry-agent.md: missing contract token in required section: `*_failed.md`
- [prompt-contract] src/prompts/weekly/test-coverage-agent.md: missing contract token in required section: `npm run lock:complete -- --agent <agent-name> --cadence <cadence>`
- [prompt-contract] src/prompts/weekly/test-coverage-agent.md: missing contract token in required section: `*_completed.md`
- [prompt-contract] src/prompts/weekly/test-coverage-agent.md: missing contract token in required section: `*_failed.md`
- [prompt-contract] src/prompts/weekly/ui-ux-agent.md: missing contract token in required section: `npm run lock:complete -- --agent <agent-name> --cadence <cadence>`
- [prompt-contract] src/prompts/weekly/ui-ux-agent.md: missing contract token in required section: `*_completed.md`
- [prompt-contract] src/prompts/weekly/ui-ux-agent.md: missing contract token in required section: `*_failed.md`
- [prompt-contract] src/prompts/weekly/weekly-synthesis-agent.md: missing contract token in required section: `npm run lock:complete -- --agent <agent-name> --cadence <cadence>`
- [prompt-contract] src/prompts/weekly/weekly-synthesis-agent.md: missing contract token in required section: `*_completed.md`
- [prompt-contract] src/prompts/weekly/weekly-synthesis-agent.md: missing contract token in required section: `*_failed.md`

```

**Root Cause:**
Many agent prompts in `src/prompts/` do not strictly follow the `Scheduler Flow` contract requirements regarding completion command and log file naming.

## Recommendations
- Fix the prompt files to include the required contract tokens.
- This seems to be a widespread issue across many agents.

## Docs Changes
None made in this run as the failure is in the codebase/prompts, not the documentation instructions themselves.
