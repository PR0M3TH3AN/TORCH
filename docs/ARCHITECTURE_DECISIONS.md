# TORCH architecture decisions

Status date: 2026-09-27

This ledger resolves the implementation decisions identified by
`PORTABLE_AGENT_FLEET_SPEC.md` section 31. A decision marked **accepted** is
the current portable-core contract. A decision marked **gated** identifies a
feature boundary TORCH must not cross until a follow-up decision and acceptance
evidence exist.

## ADR-001: SQLite state and retention

**Status:** accepted.

Machine-local structured state uses one SQLite database per installed project,
with WAL, foreign keys, and a bounded busy timeout. Messages, acknowledgements,
audit records, presence, leases, check receipts, integration requests, context
samples, schedule runs, and Fleet changes share the project identity but remain
separate tables. TORCH performs no automatic history deletion. Retention or
compaction must be an explicit, owner-authorized operation added with recovery
tests; until then, durable records are append-preserving.

## ADR-002: Control-plane transport

**Status:** accepted.

The service layer is an in-process API. The agent-facing transport is MCP over
stdio and the non-MCP fallback is the structured CLI. The Fleet Console exposes
a read-only loopback HTTP projection of the same services. There is no required
daemon, Unix socket, network message queue, or hosted database. A future socket
transport must preserve identity binding and cannot become the data model.

## ADR-003: Project identity and repository moves

**Status:** accepted for the first release; moves are gated.

Installation creates an opaque project UUID stored in tracked configuration,
the ownership manifest, and machine-local metadata. All three must agree.
Machine-local state also records the canonical absolute repository root, and a
different root fails closed. Moving a managed repository therefore requires a
future explicit migration command that verifies identity and rewrites only the
local root binding; TORCH must not infer a move from a matching directory name.

## ADR-004: Runtime process supervision

**Status:** accepted.

Runtime adapters own process-specific creation, resume, status, capture, and
stop behavior and declare every capability. TORCH persists stable Fleet
identity and runtime session IDs but does not require a resident supervisor.
Unsupported controls fail explicitly and durable messages remain available.
The optional system-schedule launcher uses user systemd on Linux; macOS and
Windows launchers are separate adapters and are not claimed by this release.

## ADR-005: Configuration and generated files

**Status:** accepted.

`.torch/torch.yaml`, approved decisions, and tracked backlog records are
authoritative. `roster.yaml` and prompts are reviewable materializations of an
approved organization. The ownership manifest records their exact hashes;
doctor reports drift, and generated prose never overrides configuration.
Changing organization requires the Fleet-change workflow rather than editing a
generated prompt and treating it as policy.

## ADR-006: Runtime capability negotiation

**Status:** accepted.

Every adapter implements the common operation surface and declares support for
each operation. Startup validates the declaration before planning a launch.
The minimum useful adapter can create or resume a session and exchange durable
messages through CLI/MCP; live steering, hooks, listing, and stopping may be
reported unsupported. TORCH never substitutes an unsupported native feature
silently.

## ADR-007: Check invalidation

**Status:** accepted for the first release.

A check pass is reusable only for the exact Git commit and the exact hash of its
configured definition. A dirty or changing worktree produces no transferable
pass. Additional non-Git inputs require a future declared input-fingerprint
schema; until then projects must encode them in the check definition or rerun
the check. Branch names alone never validate a receipt.

## ADR-008: Local canonical remote naming

**Status:** accepted.

The local bare canonical remote is named `torch-canonical`, never `origin`, and
lives under machine-local project state as `remote.git`. Creation refuses an
existing path, remote-name collision, or dirty checkout. The configured remote
and path are recorded in tracked configuration and the ownership manifest.

## ADR-009: Multi-machine security

**Status:** gated.

The first release is single-machine and exposes no network control-plane write
surface. Multi-machine transport is prohibited until a separate decision
defines mutual authentication, encryption, project isolation, replay defense,
revocation, and recovery, with adversarial acceptance tests. A forge remote is
not a substitute for control-plane authentication.

## ADR-010: Distribution and update signing

**Status:** gated.

Local candidate builds use exact tree hashing, versioned compatibility
metadata, isolated state, and atomic activation/rollback. They are not signed.
Publishing a package or enabling unattended remote updates is blocked until a
follow-up decision selects artifact signing, trusted-key rotation, provenance,
and offline rollback verification. Local `npm pack` qualification does not
claim supply-chain authenticity.

## ADR-011: Project-specific coordination hierarchy

**Status:** gated.

The current organization model has one required `session-manager` identity and
flat implementation domains. TORCH's Fleet-evolution service can propose
specialist additions, retirements, and domain-boundary changes, but it does not
yet model Program Directors, Fleet Operations, multiple levels of domain leads,
or role promotion as durable authority-bearing relationships. Do not represent
that capability as implemented or encode COMBATRIG's proposed departments as
the default organization.

The target design is an owner-approved, versioned organization graph generated
from each project's repository and specification. It separates
implementation ownership from coordination, fleet operations, program
priority, and independent review authority. The graph permits optional
coordination levels, one primary owner-facing role, and direct peer
communication. Reporting links do not confer worktree access, task
reassignment, or release authority. One shared backlog remains authoritative;
program and domain documents are summaries, not task queues.

Before implementation, a follow-up decision and acceptance scenarios must
define role schemas and permissions, Session Manager compatibility, how the
Session Architect proposes measured hierarchy changes, owner approval, safe
promotion/reassignment, active-task and branch preservation, staged
provisioning, startup/wind-down order, rollback, and hierarchy-aware doctor and
console views. A proposed lead must own a concrete integrated outcome, and
headcount alone must never trigger an added management layer.

## Consequences

These decisions keep the first usable release local-first and provider-
independent. They also make current boundaries explicit: repository moves,
multi-machine control, non-Linux persistent launchers, and published update
channels, and multi-level organization management are unavailable rather than
silently approximated.
