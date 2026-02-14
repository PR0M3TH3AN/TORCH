# TORCH: Task Orchestration via Relay-Coordinated Handoff

TORCH is a decentralized task-locking protocol for multi-agent software development.

## Quick start

```bash
# Check active locks
node src/nostr-lock.mjs check --cadence daily

# Claim a task
AGENT_PLATFORM=codex node src/nostr-lock.mjs lock --agent docs-agent --cadence daily

# List all active locks
node src/nostr-lock.mjs list
```

## Defaults

- Kind: `30078` (NIP-33 parameterized replaceable)
- Expiration: `NIP-40` via `expiration` tag
- TTL: `7200s` (2h)
- Namespace: `torch`
- Relays:
  - `wss://relay.damus.io`
  - `wss://nos.lol`
  - `wss://relay.primal.net`

## Environment variables

- `NOSTR_LOCK_NAMESPACE`
- `NOSTR_LOCK_RELAYS`
- `NOSTR_LOCK_TTL`
- `NOSTR_LOCK_QUERY_TIMEOUT_MS`
- `NOSTR_LOCK_DAILY_ROSTER`
- `NOSTR_LOCK_WEEKLY_ROSTER`
- `TORCH_CONFIG_PATH`
- `AGENT_PLATFORM`

## torch-config.json

You can configure TORCH per repository with a root-level `torch-config.json` file.

Common settings:

- `nostrLock.namespace` — namespace prefix used in d-tags and hashtags.
- `nostrLock.relays` — relay list for check/lock/list operations.
- `nostrLock.ttlSeconds` — default lock TTL.
- `nostrLock.queryTimeoutMs` — relay query timeout.
- `nostrLock.dailyRoster` / `nostrLock.weeklyRoster` — optional per-project roster overrides.
- `dashboard.defaultCadenceView` — default dashboard view (`daily`, `weekly`, `all`).
- `dashboard.defaultStatusView` — default dashboard status filter (`active`, `all`).
- `scheduler.firstPromptByCadence.daily` / `.weekly` — first-run scheduler starting agent.

Default first-run daily scheduler prompt is `scheduler-update-agent`.

## Roster precedence

The lock CLI resolves roster names in this order:

1. `NOSTR_LOCK_DAILY_ROSTER` / `NOSTR_LOCK_WEEKLY_ROSTER` (comma-separated env overrides).
2. `torch-config.json` (`nostrLock.dailyRoster` / `nostrLock.weeklyRoster`).
3. `src/prompts/roster.json` (`daily` / `weekly` canonical scheduler roster).
4. Built-in fallback roster (used only if `src/prompts/roster.json` is unreadable).

`lock --agent` validates names against the resolved cadence roster, and `check`/`list` report lock events whose agent names do not match scheduler roster entries exactly.


## Exit codes

- `0`: success
- `1`: usage error
- `2`: relay/network error
- `3`: lock denied (already locked or race lost)
