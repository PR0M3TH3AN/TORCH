# Documentation Alignment Report
**Agent:** docs-alignment-agent
**Date:** 2026-02-14

## Audit Summary
A comprehensive audit of the repository documentation (`README.md`, `src/docs/TORCH.md`) was performed against the codebase (`bin/torch-lock.mjs`, `src/lib.mjs`, `src/ops.mjs`, `src/torch-config.mjs`).

The audit revealed that while the core locking commands were documented, several administrative and new commands (init, update, complete, memory operations) were missing from the primary documentation.

## Claims Map

| Claim / Feature | Source Doc | Code Implementation | Status | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `check` command | `README.md` | `bin/torch-lock.mjs` | ✅ Matches | Correctly documented. |
| `lock` command | `README.md` | `bin/torch-lock.mjs` | ✅ Matches | Correctly documented. |
| `list` command | `README.md` | `bin/torch-lock.mjs` | ✅ Matches | Correctly documented. |
| `dashboard` command | `README.md` | `bin/torch-lock.mjs` | ✅ Matches | Correctly documented. |
| `complete` command | `README.md` | `src/lib.mjs` (cmdComplete) | ⚠️ Missing | **Fixed:** Added usage example. |
| `init` command | `README.md` | `src/ops.mjs` (cmdInit) | ⚠️ Missing | **Fixed:** Added usage example. |
| `update` command | `README.md` | `src/ops.mjs` (cmdUpdate) | ⚠️ Missing | **Fixed:** Added usage example. |
| Memory CLI | `README.md` | `bin/torch-lock.mjs` | ⚠️ Missing | **Fixed:** Added `list-memories`, `inspect-memory`, etc. |
| Quick Start | `src/docs/TORCH.md` | `bin/torch-lock.mjs` | ⚠️ Outdated | **Fixed:** Updated `node src/nostr-lock.mjs` to `npx torch-lock`. |
| Configuration | `README.md` | `src/torch-config.mjs` | ✅ Matches | Config keys align with implementation. |

## Validation Notes
- **Verification Method:** Static code analysis of `bin/torch-lock.mjs` arg parsing and `src/lib.mjs` / `src/ops.mjs` function signatures compared against documentation text.
- **Updates Applied:**
  - `README.md`: Added `complete`, `init`, `update` commands and Memory CLI section.
  - `src/docs/TORCH.md`: Updated outdated command examples to use the `npx torch-lock` convention.

## Recommendations
- Future updates to the CLI should include a documentation update step in the PR checklist.
- Consider auto-generating the CLI usage section from the `bin/torch-lock.mjs` help text (output of `usage()`) to ensure perfect synchronization.
