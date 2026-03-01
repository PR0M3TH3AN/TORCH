# Memory Events Contract

This contract defines the merge-safe memory pipeline used by `torch-lock memory`.

## Source of Truth

- Append-only event files:
  - `memory/events/YYYY/MM/DD/<timestamp>_<id>.json`
- Event schema:
  - `memory/schema/memory-event.schema.json`
- Generated artifact:
  - `memory_update.md`

## Commands

### `torch-lock memory add`

Writes exactly one new event file.

Required flags:
- `--agent`
- `--topic`
- one of `--message` or `--message-file`

Optional flags:
- `--created-at` (RFC3339 UTC, default: now)
- `--id` (UUIDv7, default: generated)
- `--run-id`
- `--tags` (comma-separated)
- `--source`
- `--project` (defaults to `TORCH`; non-`TORCH` is rejected by schema)
- `--events-dir` (default: `memory/events`)
- `--schema-path` (default: `memory/schema/memory-event.schema.json`)

Behavior:
- Validates event against schema contract before writing.
- Enforces append-only naming: `<timestamp>_<id>.json`.
- Fails if target file already exists.

### `torch-lock memory build`

Builds deterministic markdown from all events.

Optional flags:
- `--events-dir` (default: `memory/events`)
- `--schema-path` (default: `memory/schema/memory-event.schema.json`)
- `--output` (default: `memory_update.md`)

Behavior:
- Loads and validates all event JSON files.
- Enforces filename/date/id contract.
- Fails on duplicate ids.
- Sorts by `(created_at ASC, id ASC, relative_path ASC)`.
- Emits auto-generated header:
  - `<!-- AUTO-GENERATED: DO NOT EDIT. Source: memory/events -->`
- Normalizes output to LF newlines and one trailing newline.

### `torch-lock memory verify`

Verification gate for CI and branch safety.

Optional flags:
- `--events-dir` (default: `memory/events`)
- `--schema-path` (default: `memory/schema/memory-event.schema.json`)
- `--output` (default: `memory_update.md`)

Behavior:
- Re-validates all events + path contract.
- Re-renders twice (determinism guard).
- Fails if output file is missing header.
- Fails if output file bytes differ from deterministic render (no-diff gate).

## Exit Codes

- `0`: success
- `1`: usage error (missing/invalid CLI arguments)
- `4`: memory contract violation
  - schema invalid
  - filename/date mismatch
  - duplicate event id
  - deterministic render mismatch
  - generated file missing header
  - generated file out of date
