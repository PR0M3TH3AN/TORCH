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

Accepted alpha.2 source: `c11754ab18fa690355ead3f6f87b3accb2975153`.
Candidate digest: `d4b6ba38a51cc1804047b175c963806850f017a92d88863d187043314414dd90`.
All 39 acceptance groups passed again from the copied candidate. Active version
is `0.1.0-alpha.2`; rollback retains alpha.1.

Normal uninstall: PASS. Retained-state restore: PASS. All seven actual agent
worktrees returned briefs through `/home/user/.local/bin/torch`: PASS. Their
briefs include the updated canonical smoke instructions despite older worktree
copies. Model configuration hash, project/installation IDs, offline states,
saved Codex runtime IDs and all seven branch tips were unchanged across
uninstall/restore. No provider was launched.

The restored project's `torch setup --yes --json` was a no-op: no commits,
no mutations, no sessions started. Final doctor reports healthy. Modified owned
configuration and unique manager history remain legitimate safety warnings,
not authorization to purge. Uninstall refreshed the manager resume brief;
that generated file was separately checkpointed on its existing branch, without
rewriting prior history or landing anything.

Receipts:

- `/tmp/torch-alpha2-candidate-build.json`
- `/tmp/torch-alpha2-uninstall-plan.json`
- `/tmp/torch-alpha2-uninstall-result.json`
- `/tmp/torch-alpha2-restore-result.json`
- `/tmp/torch-alpha2-reinstall-verification.json`
- `/tmp/torch-alpha2-real-setup-result.json`
- `/tmp/torch-alpha2-real-doctor.json`

This tests retained-state reinstall, not destructive purge or a fresh installation
with discarded configuration. New-install setup is covered by isolated real-Git
regression tests. Provider-authentication and new agent launches were deliberately
not repeated. Host timers remain uninstalled.
