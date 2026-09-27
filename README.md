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
- first-class repository and external-specification startup inputs;
- spec-fingerprinted, evidence-linked fleet design with stale-spec refusal;
- evidence-linked architecture graphs and domain-collision proposals;
- owner-reviewed organizational proposals required before installation;
- strict versioned project-configuration validation with explicit migration blockers;
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
- revision-checked tracked backlog tasks with dependencies, evidence, and landed-commit completion;
- live ownership, neighbours, handoff, coordination, completion, and blocker operations;
- equivalent CLI and identity-bound MCP surfaces;
- current MCP stdio interoperability through the official protocol SDK;
- an explicit-capability Claude adapter with durable-message fallback;
- an explicit-capability Codex adapter with resumable JSONL thread capture;
- per-domain mixed Claude/Codex runtime planning and identity-bound MCP registration plans;
- durable-first Codex steering with native `queue` notification when available;
- worker-first/Session-Manager-last fresh start and resume planning;
- safe wind-down with active-work refusal and local resume snapshots.
- shell-free configured checks with exact-commit receipts;
- transactional FIFO resource queues and leases;
- a native integration queue with durable authorization and fast-forward main protection;
- domain-owned convergence plans that defer during checks, measurements, pins, dirty work, and Git operations;
- a local bare canonical Git option with honest one-disk/local-remote grading;
- mutation audit events tied to project and Fleet identity.
- isolated candidate version stores with explicit compatibility declarations;
- acceptance-gated atomic activation, crash reconciliation, and exact rollback.
- a read-only COMBATRIG compatibility importer that preserves legacy prompts,
  branch/worktree mappings, checks, resources, schedules, release boundaries,
  and backlog inventory while refusing to invent missing ownership boundaries.
- a redesigned public product site and read-only local Fleet Console backed by
  the same repository and runtime state rather than a separate dashboard model.
- identity-bound context-usage telemetry that separates measurements from
  estimates and relates cost/cache behavior to verified work;
- validated system/session schedules with shell-free actions, authority,
  retries, durable run evidence, and explicit approval for mutation;
- an owner-approved user-systemd launcher for system schedules, bound to the
  exact tracked configuration digest and recorded for exact reversal.
- durable Fleet evolution: the Session Manager can propose a justified new
  persistent domain, while owner approval gates the configuration commit,
  identity, prompt, branch, and worktree activation; it can also propose safe
  retirement when coordination cost exceeds continuing value, preserving the
  branch and refusing live, dirty, guarded, leased, or active work.

Live mixed-provider qualification, stable self-host bootstrapping, COMBATRIG
cutover, installation of the implemented system-schedule launcher on this
machine, and public deployment remain staged work.

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

Design a fleet for any selected Git project from its code, one or more project
specifications, or both:

```bash
node bin/torch.mjs analyze \
  --repo /path/to/project \
  --spec /path/to/product-spec.md \
  --json

node bin/torch.mjs bootstrap \
  --repo /path/to/project \
  --spec /path/to/product-spec.md \
  --output fleet-design-brief.json \
  --json

node bin/torch.mjs design \
  --repo /path/to/project \
  --spec /path/to/product-spec.md \
  --output fleet-proposal.json \
  --json
```

`--spec` is repeatable. TORCH reads specifications as untrusted project data,
extracts responsibilities and evidence references without executing their
contents, and records their SHA-256 digests. A prose-only project can receive a
responsibility-oriented fleet proposal before source exists, but unresolved
path ownership remains visibly blocked for owner review. Installation refuses
a proposal if a selected specification has changed since design.

`torch bootstrap` is the provider-independent AI entrypoint. It produces a
bounded Session Architect brief containing reconnaissance, specification
evidence, the deterministic baseline, unassigned components, unresolved
ownership, collision questions, and the required pending-proposal contract. A
Codex, Claude, or other planning session can reason over that artifact without
TORCH choosing a provider or incurring an implicit model call. `torch design`
remains the deterministic baseline and fallback.

Preview an isolated Claude or Codex architecture call, validate an externally
produced proposal, or explicitly execute the call:

```bash
torch architect plan --brief fleet-design-brief.json --provider codex --json
torch architect validate --brief fleet-design-brief.json --response fleet-proposal.json --json
torch architect run --brief fleet-design-brief.json --provider codex \
  --output fleet-proposal.json --yes --json

torch architect run --brief fleet-design-brief.json --provider claude \
  --max-budget-usd 1 --output fleet-proposal.json --yes --json
```

Planning never invokes a provider. Running requires `--yes`; Claude also
requires an explicit dollar ceiling. The planner is read-only and isolated
from project agent rules, hooks, tools, and MCP configuration. TORCH rejects a
response that changes provenance, invents ownership or evidence, references
unknown checks/resources, chooses an unsupported runtime, adds schedules, or
claims its own approval. A valid result still requires owner review before
installation.

Import an existing COMBATRIG fleet into the same pending-review proposal
format without changing the source repository:

```bash
node bin/torch.mjs import combatrig \
  --source /path/to/COMBATRIG \
  --output combatrig-proposal.json \
  --json
```

The command exits with status `1` while blocking migration gaps remain. That
is a review result, not permission for TORCH to infer missing path ownership.

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

Starting or stopping configured runtime sessions is always a separate explicit
step:

```bash
node bin/torch.mjs up --fresh --yes --json
node bin/torch.mjs down --dry-run --json
node bin/torch.mjs down --yes --json
```

The Fleet can evolve when recurring work develops a coherent new boundary.
The Session Manager may propose the domain through MCP or the CLI, but cannot
approve or activate it. Owner approval and activation are deliberately
separate, and runtime startup remains another explicit step:

```bash
torch fleet propose --from session-manager --proposal new-domain.json --json
torch fleet approve --change <change-id> --by <owner> --yes --json
torch fleet plan --change <change-id> --json
torch fleet activate --change <change-id> --by <owner> --yes --json
torch fleet start --change <change-id> --fresh --dry-run --json
torch fleet start --change <change-id> --fresh --yes --json
```

The proposal records recurring-work evidence, anticipated context-locality
benefit, coordination cost, ownership, neighbours, checks, and runtime. TORCH
rejects silent ownership overlap, unknown checks/runtimes, worker-created
roster changes, stale activation commits, and activation without matching
owner approval.

The CLI fallback exposes `agents`, `who-owns`, `message`, `inbox`, `ack`,
`status`, `complete`, `blocked`, `coordinate`, `handoff`, and the tracked
`backlog` lifecycle. MCP hosts launch
`torch-mcp --root /path/to/repository --area <fleet-id>` and receive the same
service operations, identity-bound to that Fleet area.

Local verification and convergence use `torch checks`, `torch resources`, and
`torch integrate`. A project without a forge can preview and create its bare
canonical store with `torch canonical plan` and `torch canonical create --yes`.

TORCH source checkouts can stage a self-host candidate without changing the
active version. Candidate build runs the complete local acceptance, lint, and
syntax gates before writing its receipt:

```bash
node bin/torch.mjs candidate plan --source . --json
node bin/torch.mjs candidate build --source . --yes --json
node bin/torch.mjs upgrade --version 0.1.0-alpha.0 --dry-run --json
node bin/torch.mjs upgrade --version 0.1.0-alpha.0 --yes --json
node bin/torch.mjs rollback --dry-run --json
```

The candidate gate requires named evidence for backlog-through-integration and
COMBATRIG compatibility, not merely a green process exit. Bootstrapping an
installed stable TORCH to manage this repository remains open.

Persistent domain sessions also create a context-locality opportunity: each
specialist can keep its relevant working set hot instead of one general session
reloading unrelated project areas. TORCH treats cache/token savings as a
measurement hypothesis until provider usage and verified task outcomes prove it.

This is still an alpha. Runtime lifecycle is scenario-tested with virtualized
Claude and Codex boundaries. The tests make no paid provider calls. A live
mixed-provider, multi-domain acceptance run remains an explicit
owner-authorized qualification gate.

Run the redesigned public surface and local operational console on loopback:

```bash
npm run site:serve -- --repo /path/to/project --port 4317
```

The public explanation is at `/`; `/console` reads Fleet state without repair
or mutation. Automation can obtain the same read-only view with:

```bash
node bin/torch.mjs console snapshot --repo /path/to/project --json
```

Runtime adapters and agents can report cache locality without conflating
provider measurements and estimates:

```bash
torch context record --area backend --source provider-response \
  --measurement measured --cache-read 24000 --uncached-input 6000 \
  --cost-microusd 420000 --verified-items 1 --json
torch context report --area backend --json
```

Configured schedules remain machine-readable and authority-gated:

```bash
torch schedules list --actor session-manager --json
torch schedules plan --id fleet-hygiene --actor session-manager --json
torch schedules run --id fleet-hygiene --actor session-manager --json
```

Mutating schedules additionally require `--yes`. Cron definitions are exposed
for an external system launcher; TORCH does not silently install persistent
timers.

## Product principles

- Git is required; GitHub is optional.
- The repository is durable organizational memory; chat sessions are workers.
- Every persistent domain owns one branch and one worktree.
- Every domain has explicit scope and explicit exclusions.
- Peers coordinate directly; the Session Manager controls priority and
  ownership.
- The Session Manager may propose Fleet growth; only the owner can approve and
  activate persistent roster changes.
- Monitoring may be automatic; active worktrees are changed intentionally.
- Verification belongs to an exact commit.
- The TORCH engine runs outside the repository it manages.
- Installation is reversible and refuses unsafe deletion.
- Stable TORCH must be able to build its successor.

## License

MIT
