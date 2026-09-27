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
The current implementation provides the portable kernel, project bootstrap,
and the first Claude reference-fleet path:

- read-only Git repository inspection;
- repository inventory and check discovery;
- evidence-linked architecture graphs and domain-collision proposals;
- owner-reviewed organizational proposals required before installation;
- explicit install approval;
- tracked `.torch/` project configuration;
- XDG-local runtime state;
- installation ownership manifest;
- health diagnostics;
- conservative, reversible purge;
- reviewed worktree plans with branch/path collision protection;
- isolated branches and worktrees with locally ignored task markers;
- purge protection for dirty and uniquely committed domain work.
- SQLite-backed stable Fleet identities and presence;
- durable direct/group messages with per-recipient acknowledgement;
- live ownership, neighbours, handoff, coordination, completion, and blocker operations;
- equivalent CLI and 14-tool MCP surfaces;
- current MCP stdio interoperability through the official protocol SDK;
- an explicit-capability Claude adapter with durable-message fallback;
- worker-first/Session-Manager-last fresh start and resume planning;
- safe wind-down with active-work refusal and local resume snapshots.

Checks, scarce-resource leases, integration policy, Codex portability,
self-hosting, COMBATRIG re-import, and the Fleet Console remain staged work.

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
node bin/torch.mjs domains --output fleet-proposal.json --json
```

Review the evidence in `fleet-proposal.json`, edit its `review.status` to
`approved`, and identify the reviewer. Then inspect and apply the installation:

```bash
node bin/torch.mjs install --proposal fleet-proposal.json --dry-run --json
node bin/torch.mjs install --proposal fleet-proposal.json --yes --json
node bin/torch.mjs doctor --json
node bin/torch.mjs worktrees --dry-run --json
node bin/torch.mjs worktrees --yes --json
node bin/torch.mjs up --fresh --dry-run --json
```

Starting or stopping Claude sessions is always a separate explicit step:

```bash
node bin/torch.mjs up --fresh --yes --json
node bin/torch.mjs down --dry-run --json
node bin/torch.mjs down --yes --json
```

The CLI fallback exposes `agents`, `who-owns`, `message`, `inbox`, `ack`,
`status`, `complete`, `blocked`, `coordinate`, and `handoff`. MCP hosts launch
`torch-mcp --root /path/to/repository --area <fleet-id>` and receive the same
service operations, identity-bound to that Fleet area.

This is still an alpha. The lifecycle is scenario-tested with a virtualized
Claude boundary; a paid live-Claude multi-domain acceptance run remains an
explicit owner-authorized qualification gate.

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
