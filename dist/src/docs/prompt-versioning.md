# Prompt Versioning and State Backup

This document describes how TORCH manages agent prompt versions and runtime state backups — two distinct but complementary systems.

---

## Overview

| Concern | Mechanism | Storage location |
|---------|-----------|-----------------|
| Prompt change control | Governance proposals | `src/proposals/` |
| Prompt version archive | Applied-proposal archive | `.torch/prompt-history/` |
| Prompt rollback | `torch-lock rollback` | Reads `.torch/prompt-history/`, falls back to git |
| State snapshot | `torch-lock backup` | `.torch/backups/<timestamp>/` |

---

## 1. Prompt Versioning

### How it works

Every agent prompt lives in `src/prompts/daily/<agent>.md` or `src/prompts/weekly/<agent>.md`. These are the canonical sources of truth.

When a change is proposed and applied through the governance system, TORCH automatically archives the **old** content before overwriting the file. The archive is stored in:

```
.torch/prompt-history/<subpath>/<basename>_<timestamp>_<sha256>.md
```

A sidecar metadata file is written alongside each archive:

```
.torch/prompt-history/<subpath>/<basename>_<timestamp>_<sha256>.meta.json
```

The sidecar records who made the change, why, and when — making the archive self-documenting.

### Filename format

```
audit-agent_2026-01-15T00-00-00-000Z_a3f5b19c....md
│            │                         │
│            │                         └─ SHA-256 of old content
│            └─ ISO timestamp (colons/dots replaced with dashes)
└─ Prompt base name
```

This naming scheme ensures versions sort lexicographically by time with no reliance on filesystem mtime.

---

## 2. Proposal Workflow (Create → Apply → Rollback)

### Step 1 — Create a proposal

```bash
torch-lock proposal create \
  --agent <agent-name> \
  --target src/prompts/daily/<agent>.md \
  --content /path/to/new-content.md \
  --reason "Add missing EXIT CRITERIA section"
```

This writes the proposal to `src/proposals/<timestamp>_<agent>/`:
- `meta.json` — author, target, reason, status
- `new.md` — proposed new content
- `change.diff` — git diff against current file

The target path must be within `src/prompts/daily/` or `src/prompts/weekly/`.

### Step 2 — List pending proposals

```bash
torch-lock proposal list
# or filter by status:
torch-lock proposal list --status pending
```

### Step 3 — Inspect a proposal

```bash
torch-lock proposal show --id <proposal-id>
```

### Step 4 — Apply the proposal

```bash
torch-lock proposal apply --id <proposal-id>
```

Before writing the new content, TORCH:
1. Validates the proposal passes all invariant checks (required contract headers)
2. Archives the **current** file content to `.torch/prompt-history/`
3. Writes the new content to the target path
4. Attempts a `git add` + `git commit` automatically

A proposal can only be applied when its status is `pending`.

### Step 5 — Reject a proposal (optional alternative)

```bash
torch-lock proposal reject --id <proposal-id> --reason "Does not preserve EXIT CRITERIA pattern"
```

---

## 3. Listing Available Versions

To see what archived versions exist for a prompt:

```bash
torch-lock rollback --target src/prompts/daily/audit-agent.md --list
```

Output (JSON array, newest first):

```json
[
  {
    "filename": "audit-agent_2026-02-20T12-00-00-000Z_a3f5b19c.md",
    "archivedAt": "2026-02-20T12:00:00.000Z",
    "hash": "a3f5b19c...",
    "proposalId": "2026-02-20T12-00-00-000Z_prompt-fixer-agent",
    "author": "prompt-fixer-agent",
    "reason": "Add missing EXIT CRITERIA section"
  }
]
```

---

## 4. Rolling Back a Prompt

### Restore the most recent version

```bash
torch-lock rollback --target src/prompts/daily/audit-agent.md
# same as:
torch-lock rollback --target src/prompts/daily/audit-agent.md --strategy latest
```

### Restore a specific version by hash fragment

```bash
torch-lock rollback --target src/prompts/daily/audit-agent.md --strategy a3f5b19c
```

Any unique fragment of the hash or timestamp in the filename works as a strategy value.

### Fallback to git

If no local archive exists, TORCH falls back to git:

```bash
# Restores the HEAD version from git (useful if .torch/ was lost)
torch-lock rollback --target src/prompts/daily/audit-agent.md --strategy latest
```

Or specify an explicit git commit SHA:

```bash
torch-lock rollback --target src/prompts/daily/audit-agent.md --strategy <git-sha>
```

The fallback uses `git checkout <commit> -- <target>`, which overwrites the file in the working tree.

---

## 5. State Backup

Agent runtime state lives outside of git in two places:

| File | Contents |
|------|----------|
| `.scheduler-memory/memory-store.json` | Agent long-term memory |
| `task-logs/daily/.scheduler-run-state.json` | Scheduler lock deferral state |

### Create a snapshot

```bash
torch-lock backup
```

This writes a timestamped directory under `.torch/backups/`:

```
.torch/backups/
└── 2026-02-20T12-00-00-000Z/
    ├── backup-manifest.json
    ├── .scheduler-memory__memory-store.json
    └── task-logs__daily__.scheduler-run-state.json
```

`backup-manifest.json` records what was captured, what was skipped (if a file was missing), the git commit at backup time, and the ISO timestamp.

### Write to a custom directory

```bash
torch-lock backup --output /path/to/my-backup-dir
```

### List existing backups

```bash
torch-lock backup --list
```

Output (JSON array, newest first):

```json
[
  {
    "id": "2026-02-20T12-00-00-000Z",
    "createdAt": "2026-02-20T12:00:00.000Z",
    "gitCommit": "a3f5b19...",
    "captured": [
      ".scheduler-memory/memory-store.json",
      "task-logs/daily/.scheduler-run-state.json"
    ],
    "backupDir": "/path/to/TORCH/.torch/backups/2026-02-20T12-00-00-000Z"
  }
]
```

### Restore from a backup

Restoration is a manual copy. From your project root:

```bash
# Restore memory store
cp .torch/backups/<id>/.scheduler-memory__memory-store.json .scheduler-memory/memory-store.json

# Restore scheduler run state
cp .torch/backups/<id>/task-logs__daily__.scheduler-run-state.json task-logs/daily/.scheduler-run-state.json
```

There is intentionally no automated restore command — restoring memory state is a significant operation that should be a deliberate human decision.

### Recommended backup cadence

The `backup-agent` (weekly) can be configured to run `torch-lock backup` as part of the weekly cycle. Alternatively, add it to your CI pipeline or cron schedule. Backups are cheap (two small JSON files) and idempotent.

---

## 6. What Is and Is Not Versioned

| Artifact | Version tracked | How |
|----------|----------------|-----|
| `src/prompts/daily/*.md` | Yes | Proposal archive + git history |
| `src/prompts/weekly/*.md` | Yes | Proposal archive + git history |
| `.scheduler-memory/memory-store.json` | Snapshot only | `torch-lock backup` |
| `task-logs/daily/.scheduler-run-state.json` | Snapshot only | `torch-lock backup` |
| `src/proposals/*/` | Permanent record | On-disk (not archived further) |
| `torch-config.json` | Git history | Standard git |

---

## 7. Storage Locations Reference

```
.torch/
├── prompt-history/                        # Prompt archive (created on first proposal apply)
│   └── src/prompts/daily/
│       ├── audit-agent_<ts>_<hash>.md    # Archived prompt content
│       └── audit-agent_<ts>_<hash>.meta.json  # Archive metadata
└── backups/                               # State snapshots
    └── <timestamp>/
        ├── backup-manifest.json
        ├── .scheduler-memory__memory-store.json
        └── task-logs__daily__.scheduler-run-state.json

src/proposals/
└── <timestamp>_<agent>/                   # One directory per proposal
    ├── meta.json
    ├── new.md
    └── change.diff
```

---

## 8. Removing TORCH

The `.torch/` directory (prompt history + backups) and `src/proposals/` are removed by `torch-lock remove`. See [docs/removal.md](removal.md) for the full removal procedure.

If you want to preserve the prompt history or state backups before removing TORCH, copy `.torch/` to a safe location first:

```bash
cp -r .torch/ ~/torch-archive-$(date +%Y%m%d)/
torch-lock remove
```
