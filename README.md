# TORCH

TORCH turns a Git repository into a persistent, coordinated team of
domain-specialized AI development sessions.

The new TORCH is being extracted from the agent-fleet operating model proven
in COMBATRIG. It is local-first, provider-independent, worktree-isolated, and
designed to manage its own development. The former Nostr lock/scheduler product
is preserved on the `legacy/nostr-torch` branch and is not part of this
architecture.

## Current status

The rewrite is under active development on `rewrite/portable-agent-fleet`.
Stage 1 currently provides the first portable kernel:

- read-only Git repository inspection;
- repository inventory and check discovery;
- explicit install approval;
- tracked `.torch/` project configuration;
- XDG-local runtime state;
- installation ownership manifest;
- health diagnostics;
- conservative, reversible purge.

Session orchestration, worktree generation, messaging, checks, integration,
runtime adapters, self-hosting, and the Fleet Console remain staged work.

The canonical architecture and delivery plan is
[docs/PORTABLE_AGENT_FLEET_SPEC.md](docs/PORTABLE_AGENT_FLEET_SPEC.md).

## Development

Requirements:

- Node.js 22 or later
- Git

Run the current verification suite:

```bash
npm test
npm run lint
npm run check
```

Inspect a repository without modifying it:

```bash
node bin/torch.mjs init --json
node bin/torch.mjs analyze --json
node bin/torch.mjs install --dry-run --json
```

Install the current kernel only after reviewing the dry run:

```bash
node bin/torch.mjs install --yes --json
node bin/torch.mjs doctor --json
```

The alpha kernel is not yet a working multi-agent fleet. Its install format may
change before the first usable release.

## Product principles

- Git is required; GitHub is optional.
- The repository is durable organizational memory; chat sessions are workers.
- Every persistent domain owns one branch and one worktree.
- Every domain has explicit scope and explicit exclusions.
- Peers coordinate directly; the Session Manager controls priority and
  ownership.
- Monitoring may be automatic; active worktrees are changed intentionally.
- Verification belongs to an exact commit.
- The TORCH engine runs outside the repository it manages.
- Installation is reversible and refuses unsafe deletion.
- Stable TORCH must be able to build its successor.

## License

MIT
