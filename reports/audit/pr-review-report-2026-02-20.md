# Log Fixer Agent — Audit Report

**Date:** 2026-02-20
**Agent:** log-fixer-agent
**Cadence:** daily
**Run window:** 2026-02-18 to 2026-02-20 (48h)

---

## Failures Found

### 1. decompose-agent — 2026-02-20T04:21:26Z (daily)

- **Failure class:** lock_backend_error
- **Detail:** Relay publish quorum failed (0/3 relays, required=1). Transient network.
- **Action:** None — per prompt policy, lock backend errors are noted but not fixed.

### 2. perf-optimization-agent — 2026-02-19T00:58:49Z (weekly)

- **Failure class:** lock_backend_error
- **Detail:** All relays returned `permanent_validation_error` (WebSocket blocked in Claude Code sandbox).
- **Action:** None — transient environment issue, not a code defect.

### 3. pr-review-agent — 2026-02-19T05:06:16Z (weekly)

- **Failure class:** execution_error / prompt_schema_error
- **Detail:** `verify-run-artifacts.mjs` exited 1 (`Verify: 1, Lint: 0`). Agent did not write required run artifacts with proper metadata fields on linux platform.
- **Action:** Documented in incident note `docs/agent-handoffs/incidents/2026-02-20-pr-review-agent-artifact-metadata-failure.md`.
- **Recommended follow-up:** `prompt-maintenance-agent` should update agent prompts to include explicit artifact metadata template.

---

## Completed Logs Reviewed for Embedded Errors

- `2026-02-20T04-21-23Z__governance-agent__completed.md` — Clean, all validations passed.

---

## Summary

| Agent | Cadence | Failure Type | Action |
|---|---|---|---|
| decompose-agent | daily | lock_backend_error | Noted, no fix |
| perf-optimization-agent | weekly | lock_backend_error | Noted, no fix |
| pr-review-agent | weekly | verify-run-artifacts exit 1 | Incident documented |

No code changes or PRs created. One incident note written.
