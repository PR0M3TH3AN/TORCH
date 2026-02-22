# Ops Module Overview (`src/ops.mjs`)

## What this module does
This module implements the core CLI operations for the Torch agent system: `init` and `update`. It handles the scaffolding of the agent environment, including directory structure creation, asset copying, configuration generation, and upgrades.

## Initialization Flow (`cmdInit`)
1.  **Resolve Configuration**:
    - Queries user for install directory, namespace, hashtag, and relays.
    - Validates inputs (prevents path injection).
2.  **Ensure Directories**:
    - Creates `torch/prompts/`, `src/proposals/`, `.torch/prompt-history/`.
3.  **Install Assets**:
    - Copies app directories (`src`, `bin`, `dashboard`, etc.).
    - Copies static files (`META_PROMPTS.md`, scheduler docs).
    - Copies prompts (`daily/`, `weekly/`).
4.  **Configure**:
    - Generates `torch-config.json`.
    - Updates `.gitignore` to exclude `node_modules`.
    - Generates `TORCH_DASHBOARD.md`.
5.  **Inject Scripts**:
    - Adds `torch:*` scripts to the host `package.json` if installed in a subdirectory.

## Update Flow (`cmdUpdate`)
1.  **Detect Installation**:
    - Finds the existing `torch` directory.
2.  **Backup**:
    - Creates a timestamped backup in `torch/_backups/`.
3.  **Update App**:
    - Overwrites application code (`src`, `bin`, etc.).
    - Overwrites static files.
4.  **Update Prompts**:
    - Adds new prompts from the package.
    - Preserves existing prompts (unless `--force` is used).
5.  **Preserve Roster**:
    - `roster.json` is preserved to avoid resetting rotation (unless `--force` is used).

## Public API

### `cmdInit(force, cwd, mockAnswers)`
Initializes a new Torch environment.
- `force`: Boolean, overwrite existing directory if not empty.
- `cwd`: Current working directory.
- `mockAnswers`: Optional object for testing (bypasses interactive prompts).

### `cmdUpdate(force, cwd)`
Updates an existing Torch environment.
- `force`: Boolean, overwrite modified prompts/roster.
- `cwd`: Current working directory.

## Key Invariants
- **Safe Installation**: `validateInstallDir` ensures the target directory name is safe (alphanumeric + safe chars).
- **Non-Destructive Defaults**: `init` fails if directory is not empty (unless forced). `update` preserves user data (prompts, roster, config) by default.
- **Backup First**: `update` always creates a full backup before modifying files.

## When to change
- When adding new CLI commands or workflows.
- When changing the directory structure or asset layout.
- When updating the default configuration logic or `torch-config.json` schema.
