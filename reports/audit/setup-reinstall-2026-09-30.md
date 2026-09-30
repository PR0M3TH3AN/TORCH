# Guided setup and reinstall verification

## Changes

- `torch brief` and normal installed-project CLI commands resolve registered
  worktrees to the canonical project. The resolver checks project and installation
  IDs, XDG state binding, Git common directory, worktree membership and branch.
  Current canonical instructions win over an old worktree copy.
- `torch setup --dry-run`, then `--yes`, checkpoints owned configuration,
  provisions worktrees and checkpoints registration. Existing staged work is
  rejected; unrelated files are not staged. Install can opt in with `--setup`.
- `torch install --restore` reattaches the retained state from normal uninstall.
  It does not overwrite profiles, erase history, recreate timers or start agents.
- The self-host smoke brief distinguishes manager backlog inspection from
  specialist next-task lookup and explicitly requires current briefs.

## Evidence before installation

All 39 source acceptance groups, lint and syntax: PASS.
Receipt: `/tmp/torch-alpha2-source-acceptance.json`.
New scenarios: guided setup, canonical worktree briefs, safe detach/restore.
The actual Owner Console worktree returned its current brief successfully
through the patched source CLI, including its preserved offline runtime ID.

## Installation trial

Pending accepted alpha.2 build and normal uninstall/restore verification.
This is a retained-state reinstall, not a purge or deletion of the tool's
historical versions. Provider launches remain deliberately disabled.
