---
agent: docs-alignment-agent
status: completed
date: 2026-02-14
---

# Docs Alignment Report

## Summary
Audited `README.md` and `src/docs/TORCH.md` against the codebase.
Identified missing documentation for:
- `complete` command
- `init` command
- `update` command
- Memory CLI commands

## Actions
- Updated `README.md` to include usage examples for the missing commands.
- Updated `src/docs/TORCH.md` to replace outdated `node src/nostr-lock.mjs` examples with `npx torch-lock`.
- Created `artifacts/docs-alignment-report.md` with a detailed claims map.

## Validation
- Verified updates by reading the files.
- Verified linting passed.
- Published completion event.
