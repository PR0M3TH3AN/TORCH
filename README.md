# TORCH: Task Orchestration via Relay-Coordinated Handoff

TORCH is a portable Nostr-based task locking toolkit for multi-agent coordination.

## Installation

```bash
npm install https://github.com/PR0M3TH3AN/TORCH/archive/refs/heads/main.tar.gz
```

> TORCH is distributed from GitHub tarballs and is not currently published to the npm registry.

## Usage

### CLI

The `torch-lock` CLI allows you to check, lock, and list tasks.

```bash
# Check locks for a specific cadence
npx --no-install torch-lock check --cadence daily

# Lock a task for an agent
AGENT_PLATFORM=codex npx --no-install torch-lock lock --agent docs-agent --cadence daily

# List all active locks
npx --no-install torch-lock list

# Run the Dashboard
npx --no-install torch-lock dashboard
```

### Configuration (`torch-config.json`)

Create a `torch-config.json` file in your project root to configure TORCH for your repository. You can use the included `torch-config.example.json` as a template.

Configuration options:

- `nostrLock.namespace` (d-tag/tag namespace)
- `nostrLock.relays` (array of relay URLs)
- `nostrLock.ttlSeconds` (lock duration in seconds)
- `nostrLock.queryTimeoutMs` (timeout for relay queries)
- `nostrLock.dailyRoster` / `nostrLock.weeklyRoster` (explicit rosters)
- `dashboard.defaultCadenceView` (`daily`, `weekly`, or `all`)
- `dashboard.defaultStatusView` (`active` or `all`)
- `scheduler.firstPromptByCadence.daily` / `.weekly` (first prompt to run)
- `scheduler.paused.daily` / `.weekly` (array of agent names to pause locally)

### Dashboard

The dashboard provides a live view of lock events.

```bash
npx --no-install torch-lock dashboard --port 4173
# Open http://localhost:4173/dashboard/
```

## Environment variables

You can override configuration using environment variables:

- `NOSTR_LOCK_NAMESPACE`
- `NOSTR_LOCK_RELAYS` (comma-separated)
- `NOSTR_LOCK_TTL`
- `NOSTR_LOCK_QUERY_TIMEOUT_MS`
- `NOSTR_LOCK_DAILY_ROSTER` (comma-separated list of agents)
- `NOSTR_LOCK_WEEKLY_ROSTER` (comma-separated list of agents)
- `TORCH_CONFIG_PATH` (path to config file)
- `AGENT_PLATFORM` (platform identifier, e.g. `codex`)

## Roster precedence

The lock CLI resolves roster names in this order:

1. `NOSTR_LOCK_DAILY_ROSTER` / `NOSTR_LOCK_WEEKLY_ROSTER` (comma-separated env overrides).
2. `torch-config.json` (`nostrLock.dailyRoster` / `nostrLock.weeklyRoster`).
3. `src/prompts/roster.json` (canonical scheduler roster included in the package).
4. Built-in fallback roster.

## Included Resources

- `src/lib.mjs` — Core library logic (can be imported in scripts)
- `src/docs/TORCH.md` — Protocol summary and usage
- `src/prompts/` — Generic scheduler prompts and flow
- `skills/` — Repository-local skill guides for agent onboarding and repeatable workflows
- `dashboard/` — Static lock dashboard assets

## NPM Scripts (for development)

If you are developing `torch-lock` itself:

- `npm run lock:check:daily`
- `npm run lock:check:weekly`
- `npm run lock:list`
- `npm run dashboard:serve`
- `npm test` (run unit tests)
- `npm run lint` (run linter)



