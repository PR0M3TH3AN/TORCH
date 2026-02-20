# Learning: Scheduler Cycle File Documentation Patterns

- **Context:** docs-code-investigator run 2026-02-20. Documented `scripts/agent/run-scheduler-cycle.mjs` (926 lines) with JSDoc, inline comments, and `docs/scheduler-cycle-overview.md`.
- **Observation:** The file's logic precisely mirrors the 19 numbered steps in `src/prompts/scheduler-flow.md`. The top-of-file comment already referenced scheduler-flow.md but didn't enumerate the steps — adding them makes the code immediately navigable.
- **Action taken:** Added module-level JSDoc with 19-step flow, JSDoc to 15 internal functions, targeted inline comments, and a full overview doc.
- **Validation performed:** Static read of full 926-line file. Call graph traced to scheduler-utils.mjs, scheduler-lock.mjs, src/utils.mjs, roster.json, and test files.
- **Recommendation for next agents:**
  1. When documenting scheduler-related files, always cross-reference `src/prompts/scheduler-flow.md` — it is the spec; the code implements it.
  2. The most non-obvious invariant: lock:complete is called ONLY after all validation gates pass. Document this explicitly when touching the scheduler.
  3. Three test files cover scheduler behavior: run-scheduler-cycle-memory-policy.test.mjs, scheduler-time-window.test.mjs, scheduler-preflight-lock.e2e.test.mjs. Run all three when changing scheduler logic.
  4. `task-logs/<cadence>/.scheduler-run-state.json` is day-scoped (resets at midnight UTC). Do not treat it as persistent cross-day storage.
