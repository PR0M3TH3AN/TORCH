# TORCH: Task Orchestration via Relay-Coordinated Handoff

TORCH is a portable Nostr-based task locking toolkit for multi-agent coordination.

## First-run quickstart

From the repository root:

```bash
npm install
cp torch-config.json /path/to/your-project/torch-config.json # optional template step when vendoring TORCH
npm run lock:check:daily
AGENT_PLATFORM=codex npm run lock:lock -- --agent docs-agent --cadence daily
npm run lock:list
```

### Project configuration (`torch-config.json`)

Create a `torch-config.json` file in your project root (or set `TORCH_CONFIG_PATH`) to override defaults per repo:

- `nostrLock.namespace` (d-tag/tag namespace)
- `nostrLock.relays`
- `nostrLock.ttlSeconds`
- `nostrLock.queryTimeoutMs`
- `nostrLock.dailyRoster` / `nostrLock.weeklyRoster`
- `dashboard.defaultCadenceView` (`daily`, `weekly`, or `all`)
- `dashboard.defaultStatusView` (`active` or `all`)
- `scheduler.firstPromptByCadence.daily` / `.weekly`
- `scheduler.paused.daily` / `.weekly` (array of agent names to pause locally)

Weekly alignment maintenance is available via `src/prompts/weekly/repo-fit-agent.md`, which is designed to keep TORCH defaults and docs tuned to the host repository over time.

Default first-run behavior is configured so daily scheduling starts with `scheduler-update-agent`.

Optional dashboard:

```bash
npm run dashboard:serve
# then open http://localhost:4173/dashboard/
```

## Included

- `src/nostr-lock.mjs` — Generic lock/check/list CLI
- `src/docs/TORCH.md` — Protocol summary and usage
- `src/prompts/` — Generic scheduler prompts and flow
- `skills/` — Repository-local skill guides for agent onboarding and repeatable workflows
- `examples/` — Optional scheduler overlay examples for adapting TORCH to downstream repositories
- `dashboard/index.html` — Static lock dashboard

## CLI dependencies

Declared in `package.json` and pinned:

- `nostr-tools@2.19.4`
- `ws@8.19.0`

## NPM script helpers

- `npm run lock:check:daily`
- `npm run lock:check:weekly`
- `npm run lock:list`
- `npm run lock:lock -- --agent <agent-name> --cadence <daily|weekly>`
- `npm run dashboard:serve`

## Environment variables

- `NOSTR_LOCK_NAMESPACE`
- `NOSTR_LOCK_RELAYS`
- `NOSTR_LOCK_TTL`
- `NOSTR_LOCK_QUERY_TIMEOUT_MS`
- `NOSTR_LOCK_DAILY_ROSTER`
- `NOSTR_LOCK_WEEKLY_ROSTER`
- `TORCH_CONFIG_PATH`
- `AGENT_PLATFORM`

## Roster precedence

The lock CLI resolves roster names in this order:

1. `NOSTR_LOCK_DAILY_ROSTER` / `NOSTR_LOCK_WEEKLY_ROSTER` (comma-separated env overrides).
2. `torch-config.json` (`nostrLock.dailyRoster` / `nostrLock.weeklyRoster`).
3. `src/prompts/roster.json` (`daily` / `weekly` canonical scheduler roster).
4. Built-in fallback roster (used only if `src/prompts/roster.json` is unreadable).

`lock --agent` validates names against the resolved cadence roster, and `check`/`list` report lock events whose agent names do not match scheduler roster entries exactly.


## Example

```bash
NOSTR_LOCK_NAMESPACE=my-project \
AGENT_PLATFORM=codex \
node src/nostr-lock.mjs lock --agent docs-agent --cadence daily
```
