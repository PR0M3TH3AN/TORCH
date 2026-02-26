# Removing TORCH from a Project

This guide covers how to completely remove TORCH from a project repository that installed it via the standard installation process (`npm install <torch-tarball> && npx torch-lock init`).

## Quick Removal (Recommended)

Run the built-in removal command from your project root:

```bash
npx torch-lock remove
```

This will:

1. Detect your TORCH installation (whether installed to `torch/` or to the project root)
2. Show a list of all artifacts that will be removed
3. Ask for confirmation before deleting anything
4. Remove all TORCH files, directories, configuration, and the npm package

To skip the confirmation prompt:

```bash
npx torch-lock remove --force
```

## What Gets Removed

The `remove` command cleans up everything that `torch-lock init` created, plus any runtime artifacts:

| Artifact | Description |
|---|---|
| `torch/` | The main TORCH install directory (contains src, bin, dashboard, scripts, prompts, etc.) |
| `torch-config.json` | TORCH configuration file at the project root |
| `.torch/` | Hidden directory for prompt history tracking |
| `.scheduler-memory/` | Runtime memory store used by the memory subsystem |
| `task-logs/` | Scheduler run logs (daily/weekly cycle logs, relay health history) |
| `src/proposals/` | Governance proposals directory |
| `torch:*` scripts in `package.json` | Convenience scripts injected into the host project's package.json |
| `node_modules/torch-lock/` | The installed npm package |

## Manual Removal

If you prefer to remove TORCH manually, or if the `remove` command is unavailable (e.g., the package was already uninstalled), follow these steps from your project root:

### 1. Remove the TORCH directory

```bash
rm -rf torch/
```

### 2. Remove TORCH configuration

```bash
rm -f torch-config.json
```

### 3. Remove hidden directories

```bash
rm -rf .torch/
rm -rf .scheduler-memory/
```

### 4. Remove runtime logs

```bash
rm -rf task-logs/
```

### 5. Remove governance proposals (if empty/unused)

```bash
# Only remove if this directory was created by TORCH and contains no user content
rm -rf src/proposals/
# Remove src/ too if it's now empty
rmdir src/ 2>/dev/null
```

### 6. Clean up package.json scripts

Remove these keys from the `"scripts"` section of your `package.json`:

```json
{
  "torch:dashboard": "...",
  "torch:check": "...",
  "torch:lock": "...",
  "torch:health": "...",
  "torch:memory:list": "...",
  "torch:memory:inspect": "..."
}
```

### 7. Uninstall the npm package

```bash
npm uninstall torch-lock
```

### 8. Clean up environment variables (if set)

If you configured TORCH environment variables in your shell profile, CI, or `.env` files, remove them:

- `NOSTR_LOCK_NAMESPACE`
- `NOSTR_LOCK_HASHTAG`
- `NOSTR_LOCK_RELAYS`
- `NOSTR_LOCK_TTL`
- `NOSTR_LOCK_QUERY_TIMEOUT_MS`
- `NOSTR_LOCK_PUBLISH_TIMEOUT_MS`
- `NOSTR_LOCK_MIN_SUCCESSFUL_PUBLISHES`
- `NOSTR_LOCK_RELAY_FALLBACKS`
- `NOSTR_LOCK_MIN_ACTIVE_RELAY_POOL`
- `NOSTR_LOCK_DAILY_ROSTER`
- `NOSTR_LOCK_WEEKLY_ROSTER`
- `TORCH_CONFIG_PATH`
- `TORCH_DASHBOARD_AUTH`
- `TORCH_MEMORY_ENABLED`
- `TORCH_MEMORY_INGEST_ENABLED`
- `TORCH_MEMORY_RETRIEVAL_ENABLED`
- `TORCH_MEMORY_PRUNE_ENABLED`
- `AGENT_PLATFORM`

### 9. Optional: Remove generated reports

If you ran lock reliability reports, you may also want to remove:

```bash
rm -rf artifacts/lock-reliability/
```

## Verifying Complete Removal

After removal, verify no TORCH artifacts remain:

```bash
# Should return no results
ls torch/ 2>/dev/null
ls .torch/ 2>/dev/null
ls .scheduler-memory/ 2>/dev/null
ls torch-config.json 2>/dev/null

# Should not contain torch-lock
npm ls torch-lock 2>/dev/null

# Should not contain torch:* scripts
grep '"torch:' package.json
```

## Re-installing TORCH

If you want to re-install TORCH later:

```bash
npm install https://github.com/PR0M3TH3AN/TORCH/archive/<commit-sha>.tar.gz --force && npx torch-lock init
```
