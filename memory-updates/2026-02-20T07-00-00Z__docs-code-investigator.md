# Memory Update — docs-code-investigator — 2026-02-20

## Key findings

- `scripts/agent/run-scheduler-cycle.mjs` (926 lines) is now documented with a 19-step module JSDoc + JSDoc on all 15 internal functions + `docs/scheduler-cycle-overview.md`. Do not re-document this file on next run.
- The scheduler's key invariant: lock:complete is called ONLY after memory evidence check, artifact check, and all validation commands pass. This ordering is critical and must be preserved in any scheduler modification.
- `src/prompts/scheduler-flow.md` is the spec; `run-scheduler-cycle.mjs` implements it. Step numbers in scheduler-flow.md map directly to code sections.

## Patterns / reusable knowledge

- **File selection heuristic:** run `git ls-files '*.js' '*.mjs' | xargs -n1 wc -l | sort -rn | head -20`, then subtract files already covered by `docs/*-overview.md`. Next best undocumented large files: `src/ops.mjs` (795 lines), `scripts/agent/scheduler-utils.mjs` (321 lines).
- **JSDoc insertion:** Use Edit tool with targeted old_string/new_string to insert JSDoc above each function. Do not use Write to rewrite the whole file — too risky for a 926-line file.
- **Docs style:** Match existing overview docs (`docs/lib-overview.md`, `docs/lock-ops-overview.md`) — sections: What it does / Where it fits / Typical call flow / Public API / Key invariants / Edge cases / Security / Related files / Why / When to change / Tests.

## Warnings / gotchas

- `npm run lint` and `npm test` not runnable in Claude Code sandbox. For documentation-only changes this is acceptable — document it in TEST_LOG but don't treat as blocking.
- `CONTEXT_20260220T041302Z.md` already exists in src/context/ (owned by prompt-maintenance-agent). Use a different timestamp for docs-code-investigator artifacts.
