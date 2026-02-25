# Contributing to TORCH

Thank you for your interest in contributing to TORCH!

## Prerequisites

- Node.js (v22+)
- npm

## User Onboarding Reference

Use this exact happy-path command sequence when onboarding TORCH into another repository:

```bash
npm install https://github.com/PR0M3TH3AN/TORCH/archive/refs/heads/main.tar.gz \
  && npx --no-install torch-lock init
```

## Setup

1.  Clone the repository.
2.  Install dependencies:

    ```bash
    npm install
    ```

3.  Copy the environment template (optional):

    ```bash
    cp .env.example .env
    ```

## Development Workflow

### Building

This project requires a build step for distribution artifacts (dashboard, landing page, tarball).

```bash
npm run build
```

### Testing

Run the full test suite:

```bash
npm test
```

For faster feedback on lock-backend unit tests:

```bash
npm run test:unit:lock-backend
```

For integration/resilience tests:

```bash
npm run test:extended-main
```

### Linting

Ensure your code follows the project's style guidelines:

```bash
npm run lint
```

ESLint is configured with `no-unused-vars` as an error. Prefix intentionally unused parameters with `_` (e.g., `_err`, `_unused`).

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add new feature
fix(scope): fix a bug
chore(scope): maintenance task
docs(scope): documentation update
test(scope): add or fix tests
```

Common scopes: `dashboard`, `scheduler`, `lock-ops`, `memory`, `ci`, `tests`, `security`.

## Adding a New Agent Prompt

Agent prompts live in `src/prompts/daily/` and `src/prompts/weekly/`. To add a new agent:

1. Create a markdown file following the naming convention: `<agent-name>.md`
2. Add the agent to the roster in `src/prompts/roster.json`
3. Run `npm run validate:scheduler` to verify roster/prompt consistency

See existing prompts for the expected format.

## Architecture Overview

- **Core library:** `src/lib.mjs` — CLI command dispatch
- **Lock operations:** `src/lock-ops.mjs` — Nostr relay publish/query with health tracking
- **Dashboard:** `dashboard/` — Static web UI served by `src/dashboard.mjs`
- **Memory subsystem:** `src/services/memory/` — Event ingestion, retrieval, pruning
- **Scheduler:** `scripts/agent/run-scheduler-cycle.mjs` — Orchestrates agent runs

For detailed architecture docs, see `docs/lib-overview.md` and `docs/lock-ops-overview.md`.

## Test Integrity

When modifying tests, follow the test integrity protocol in `CLAUDE.md`. Tests are behavioral specifications — never weaken assertions to make them pass.

## Pull Requests

- Keep PR titles short (under 70 characters)
- Include a summary of changes and test plan in the description
- Ensure `npm run lint` and `npm test` pass before submitting
- Reference related issues where applicable

## Reporting Issues

If you encounter bugs or have feature requests, please open an issue on GitHub.
