# Hermit "text file busy" (ETXTBSY) blocks all Torch commands on Goose Desktop

## Context

- **Date discovered:** 2026-02-15
- **Platform:** Goose Desktop (Linux), any version shipping `/usr/lib/goose/resources/bin/node-setup-common.sh`
- **Impact:** 100% of Torch lock/check/complete commands fail. Daily and weekly scheduler runs cannot proceed.
- **Severity:** Critical — completely blocks all agent scheduling.

## Observation

Every `node` or `npx` invocation on Goose Desktop runs through a Bash wrapper (`/usr/lib/goose/resources/bin/node`) that sources `node-setup-common.sh`. This setup script:

1. Downloads the hermit binary (~20 MB ELF) directly into `~/.config/goose/mcp-hermit/bin/hermit`
2. Runs `hermit init` — which **overwrites its own binary** in-place (replaces the ELF with a ~1.5 KB shell stub)
3. On Linux, writing to a binary that is currently executing produces `ETXTBSY` ("text file busy")

The error is **100% reproducible** on clean state. Once hermit is downloaded, `hermit init` always fails because the running process holds the binary open.

### Secondary bug: exit code swallowing

The Goose `node` wrapper also swallows non-zero exit codes:

```bash
node "$@" || log "Failed to execute 'node' with arguments: $*"
```

This means `torch-lock lock` returning exit 3 (lock denied) appears as exit 0 to the caller, breaking the scheduler's lock-race retry logic.

## Root cause analysis

```
/usr/lib/goose/resources/bin/node (bash wrapper)
  → sources node-setup-common.sh
    → downloads hermit ELF binary to ~/.config/goose/mcp-hermit/bin/hermit
    → runs: hermit init
      → hermit init tries to overwrite ~/.config/goose/mcp-hermit/bin/hermit
      → ETXTBSY because that's the binary currently executing
      → ERR trap fires → script exits 1
```

## Fix applied (local workaround)

Patched `node-setup-common.sh` at `/home/user/.local/goose-fix/bin/node-setup-common.sh` with three changes:

### 1. Atomic download (prevents partial writes / concurrent corruption)
```bash
HERMIT_TMP=$(mktemp ~/.config/goose/mcp-hermit/bin/.hermit-download.XXXXXX)
curl ... | gzip -dc > "$HERMIT_TMP"
chmod +x "$HERMIT_TMP"
mv -f "$HERMIT_TMP" "$HERMIT_BIN"   # atomic rename
sync
```

### 2. Copy-for-init (prevents ETXTBSY)
```bash
HERMIT_INIT_COPY=$(mktemp /tmp/.hermit-init-copy.XXXXXX)
cp "$HERMIT_BIN" "$HERMIT_INIT_COPY"
chmod +x "$HERMIT_INIT_COPY"
"$HERMIT_INIT_COPY" init   # executing binary ≠ write target → no ETXTBSY
rm -f "$HERMIT_INIT_COPY"
```

### 3. flock for concurrency (prevents download races)
```bash
exec 9>"$HERMIT_LOCK"
flock -w 30 9
# ... download + init ...
flock -u 9
```

### 4. Save/restore working directory
```bash
_GOOSE_ORIG_CWD="$(pwd)"
cd ~/.config/goose/mcp-hermit
# ... setup ...
cd "$_GOOSE_ORIG_CWD"   # restore so caller's relative paths work
```

## Validation performed

```bash
# Clean state test (from scratch):
rm -rf ~/.config/goose/mcp-hermit
PATH=/home/user/.local/goose-fix/bin:$PATH node bin/torch-lock.mjs check --cadence daily
# → Exit 0, full JSON output with lock state
# → hermit downloaded, initialized, node installed, lock check completed
```

## What needs to happen upstream

### Goose repo PR (permanent fix)
1. Apply the patch from `docs/agent-handoffs/incidents/goose-hermit-etxtbsy-fix.patch` to `/usr/lib/goose/resources/bin/node-setup-common.sh`
2. Fix exit code swallowing in `/usr/lib/goose/resources/bin/node` and `npx`:
   ```bash
   # Before (swallows exit code):
   node "$@" || log "Failed to execute 'node' with arguments: $*"
   # After (preserves exit code):
   node "$@"
   ```
3. File: <https://github.com/block/goose> — component: `resources/bin/node-setup-common.sh`

### Torch repo (defensive improvement, optional)
- Add `HERMIT_BIN_PATH` env var support so operators can point to a pre-initialized hermit
- Add diagnostics to lock preflight failure messages (hermit stderr, `fuser` output, suggested fixes)

## Recommendation for next agents

- Until the upstream Goose fix ships, use `PATH=/home/user/.local/goose-fix/bin:$PATH` before any `node`/`npm` commands
- If hermit gets stuck again: `rm -rf ~/.config/goose/mcp-hermit` and retry
- The exit code swallowing bug means schedulers must parse stdout for `LOCK_STATUS=denied` rather than relying on exit codes
