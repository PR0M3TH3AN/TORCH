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
a read-only loopback HTTP observation projection, plus only specifically
approved local owner actions documented in separate decisions. There is no
required daemon, Unix socket, network message queue, or hosted database. A
future socket transport must preserve identity binding and cannot become the
data model.

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

The installed organization config now accepts a versioned role graph, and
TORCH persists sustained-evidence proposals, exposes them for owner review,
and prepares a read-only pilot plan. A separate owner-confirmed CLI activation
now commits the approved graph, derived manager schedules, ownership-manifest
hashes, and pilot record after freshness checks. It does not launch an identity
or modify a system timer. Doctor reports graph roles bound to missing
identities, and the read-only Console renders approved roles, identity status,
reporting links, coordination links, and implementation ownership. Fresh,
resumed, and on-demand identity briefs now include the current role,
responsibility, authority, reporting, direct-report, coordination, and
implementation-ownership context from the active graph, bound into the prompt
digest. A new read-only hierarchy assessment measures recurring cross-domain
backlog, coordination-request, manager-approval, and handoff events in each
project's configured observation window; it recommends review but never creates
or activates a role. Real-fleet measurement, roster binding across every
activation path, pilot outcome measurement, adoption, and reversal remain
incomplete.
Do not represent the full adaptive organization as implemented or encode
COMBATRIG's proposed departments as the default organization.

The target design is an owner-approved, versioned organization graph generated
from each project's repository and specification. It separates
implementation ownership from coordination, fleet operations, program
priority, and independent review authority. The graph permits optional
coordination levels, one primary owner-facing role, and direct peer
communication. Reporting links do not confer worktree access, task
reassignment, or release authority. One shared backlog remains authoritative;
program and domain documents are summaries, not task queues.

A proposed lead must own a concrete integrated outcome. In this design,
headcount alone must never trigger an added management layer. Before this ADR
can be closed, TORCH still needs real fleet-pressure assessment, pilot outcome
measurement, adoption, and reversal. Owner-approved pilot activation is
available through the CLI and the local Console's fresh-plan, same-origin
preview/confirm flow. Active tasks, branches, messages, and implementation
ownership must remain preserved throughout.

## ADR-012: Per-identity runtime and model portability

**Status:** accepted as a product requirement; implementation gated.

TORCH's policy, identity, backlog, and inter-session communication are
provider-independent. Each persistent identity must be assignable an
owner-reviewed runtime profile, including adapter, model identifier, optional
reasoning settings, and launch policy. A single Fleet may mix Claude, Codex,
Pi, other local agent CLIs, and different model tiers at once. Provider/model
labels remain project configuration rather than TORCH-wide assumptions.

An adapter registry must combine built-in and explicitly installed local
plugins. Plugins declare lifecycle capabilities and unsupported settings;
TORCH may not silently substitute a runtime. Durable TORCH messages remain the
inter-session source of truth when a runtime lacks native messaging or live
steering. Runtime-profile changes preserve identity, backlog, worktree, and
resume state, and remain separate from explicit process startup.

The current implementation is partial: install/config, doctor, and lifecycle
startup share a capability-declaring registry; identities can select registered
adapters and model/reasoning profiles; unsupported settings block launch instead
of falling back. Built-in adapters include Claude, Codex, and Pi. The Pi adapter
uses explicit provider/model profiles, Pi's extension API, and an identity-bound
TORCH MCP server started only for individual tool calls; it runs one resumable
turn per process and stores Pi transcripts outside the repository. Pi's local
CLI contract and bridge are covered by regression tests, and installed Pi
0.80.3 passes an offline, no-session extension startup without a provider turn.
Other Pi versions and live provider resume remain qualification gates. Custom
adapter registration still requires an
embedding caller for programmatic use. Profile review and changes are available
through `torch profile show`, `torch profile
set`, and `torch profile defaults`; they validate and write only project-local
config and do not launch runtimes. A user-managed local plugin trust flow now
pins an absolute CommonJS entrypoint to an explicitly reviewed SHA-256 outside
the repository, validates it before registry loading, and lets profile changes
select newly trusted adapters without editing TORCH source. Project config
cannot grant plugin trust, `runtimes list` does not execute plugins, and
revocation does not affect an already-running process. Launch policy uses a
nested `launchPolicy` object in a runtime default (`runtimes.<adapter>`) and/or
identity (`session_manager` or `domains[]`). Identity keys override matching
default keys; omitted keys inherit. Adapters declare exact supported
field/value sets. Unknown fields/values, unsafe modes, and incompatible
combinations block doctor and startup planning before a runtime process is
executed. Custom adapters without `capabilities.launchPolicy.fields` accept no
overrides. `torch profile show`, `profile set`, and `profile defaults` expose
effective policy; edits require `--yes` and change future plans only.

The local Console also supports per-identity changes through a same-origin,
single-use owner preview followed by explicit confirmation. Preview runs the
same CLI validation path as profile edits; confirmation rechecks the exact
configuration digest before writing and records an owner audit event. The UI
shows current versus next-launch state and does not start or alter a running
session. Only built-in and verified, explicitly user-trusted adapters are
offered as available choices.

Codex supports `sandbox=read-only|workspace-write|danger-full-access` and
`approval=on-request|never|approve-for-me`. `approve-for-me` maps only to
`--approve-for-me` and conflicts with an explicit sandbox because the flag
implies workspace-write; other approval modes map to `--ask-for-approval`.
Fresh defaults preserve the previous invocation with `approval=approve-for-me`
and no redundant sandbox field. The historical generated flat pair
`sandbox=workspace-write`, `approval=approve-for-me` is interpreted as that same
effective mode and migrated by the profile CLI before policy edits. Claude
supports only `permissionMode=default|acceptEdits|auto|manual|dontAsk|plan`;
`bypassPermissions` is excluded. Pi exposes no policy overrides and retains
TORCH's fixed `--no-approve`, `--no-extensions`, and `--no-context-files`.

Remaining portability gates: supported-version Pi runtime matrix coverage and
live mixed-provider resume evidence.
Pi extensions execute with Pi's operating-system permissions, so only the
bundled reviewed bridge is loaded for TORCH sessions; project extension
discovery and project trust are disabled for these invocations.

Built-in starting profiles are Codex `gpt-6-luna` with high reasoning effort
and Claude `sonnet`. These are editable defaults, not fixed policy: after
install, change `runtimes.codex.model` / `runtimes.codex.reasoning` or
`runtimes.claude.model` in `.torch/torch.yaml`; set `model` and/or `reasoning`
on `session_manager` or an individual `domains[]` identity to override that
runtime's default. Profile edits do not start, stop, or replace sessions.
Codex receives the selected reasoning effort as an invocation-scoped
`model_reasoning_effort` override, leaving the user's global Codex config
untouched.

Runtime defaults and per-identity overrides are resolved consistently by
startup planning, doctor, the live identity/agent interfaces, and dashboard
snapshots. Agents can query their own effective profile without relying on a
stale prompt copy. Owners can use `torch profile show`, `torch profile set`, and
`torch profile defaults` to review or edit installed project-local profiles.
Each write requires explicit `--yes`, validates the full project config, and
only changes future launch plans; it never starts or reconfigures a running
session.

## ADR-013: Repository analysis snapshot and approval freshness

**Status:** accepted.

Repository analysis operates on the live working tree: tracked files plus
unignored, non-symlink regular files not yet tracked. It reports tracked and
untracked coverage separately and never executes project content. A domain
proposal binds Git history, `HEAD`, external specification hashes, and a
working-tree fingerprint over visible paths plus analysis-relevant source and
manifest contents. Installation recomputes this fingerprint; any relevant
working-tree drift invalidates approval even when the commit has not changed.
Ignored files are excluded, and the fingerprint is provenance only—it is not
an authorization token.

The deterministic baseline assigns a shared path to a domain only when the
repository graph shows that domain importing that shared component. Other
repository-level candidates remain visible for Session Architect and owner
review; they are not blanket-granted as editable shared paths to every domain.

## ADR-014: Local visual evidence and owner feedback

**Status:** accepted.

Visual review evidence is registered only against an existing backlog task owned
by the publishing Fleet identity, with a full local Git commit SHA and the
runtime session ID captured at publication time. TORCH accepts bounded PNG,
JPEG, WebP, and GIF files from that identity's worktree, rejects symbolic-link
paths, and copies image bytes into the project's private external local state.
The catalog stores content hashes and exposes images only through an
integrity-checking local Console route; project repositories do not gain image
blobs or a second artifact ledger.

Owner comments use the durable message stream as their source of truth. A
comment preview identifies the image, task, target identity, commit, and
message effect before an explicit owner confirmation creates the message. The
Console's loopback feedback endpoint requires a same-origin JSON request and a
single-use, five-minute token bound to the exact preview; confirmation
recomputes the plan, while stale, cross-origin, expired, or replayed requests
fail without creating a message. The snapshot API remains GET-only, and the
Console gains no general task, identity, or lifecycle write access. Private
model reasoning is never exposed. Missing or changed image bytes appear
unavailable, not as verified evidence.

## ADR-015: Browser-local saved backlog views

**Status:** accepted.

Named Console views are bounded, schema-versioned browser preferences scoped by
stable project identity. A view stores only a name and filters over fields
already present in the authoritative backlog snapshot. It does not duplicate
tasks, statuses, ownership, or queue ordering, and it never calls a write API.
Storage errors or malformed data fall back to the unfiltered backlog with an
explanatory status. View edits are explicit: owners may save a new view, update
the selected one, or delete it; each action affects only this browser's saved
presentation preferences.

## ADR-016: Backlog-derived feature and milestone progress

**Status:** accepted.

Backlog tasks may carry optional bounded `feature` and `milestone` labels.
The Session Manager may set labels at task creation or update them with a
revision-checked, reasoned classification action; task-local history and the
control-plane audit record preserve the change. Labels never change task state,
owner, dependencies, evidence, or queue order. The Console derives group status
and completion from the same task records and does not create initiative
records, another task ledger, or inferred project taxonomy. Canceled work is
reported but omitted from the completion denominator. Test, integration,
release, deployment, and live-verification gates remain distinct evidence and
cannot be inferred from progress percentages.

## ADR-017: Preview-confirmed owner priority changes

**Status:** accepted.

The loopback Console may expose one bounded owner control: change a task's
priority. Every change requires a same-origin loopback request, an explicit
reason, a revision-bound single-use preview, and separate confirmation. The
service records the owner, reason, prior/new values, timestamp, revision, and
audit event. The action cannot change state, ownership, evidence, dependencies,
integration, or release status. The snapshot endpoint remains GET-only and no
general-purpose Console mutation API is introduced.

## ADR-018: Preview-confirmed owner task proposals

**Status:** accepted.

The loopback Console may let the configured project owner propose one new
backlog task through an exact, same-origin, five-minute preview and a separate
confirmation. Confirmation creates the task as `proposed` and unassigned;
selected domains are routing suggestions only. The Session Manager retains
triage, readiness, dependency, and assignment authority. Creation records an
owner audit event and is idempotent for a repeated confirmation token. It does
not start, stop, or steer any runtime. The task remains in the existing
authoritative backlog and the observation endpoint remains GET-only.

## ADR-019: Serialized canonical integration

**Status:** accepted.

TORCH owns one serialized landing authority per project. Landing acquires a
cross-process project-state write lock before revalidating the request, target
branch, exact check receipts, authorization, and fast-forward eligibility. The
lock remains held through the canonical Git ref update and durable result
record. A competing lander fails closed with a retryable busy result and must
recompute its plan; after target advancement, stale candidates converge and
rerun required checks on the exact resulting commit. Authorized requests are
drainable in durable insertion order through one explicit `torch integrate
drain` invocation. After each landing, later requests are re-evaluated; sibling
tips that omit the new target become `needs_convergence` until their owner
merges the current target and records fresh exact-commit checks. The drain is
one-shot by default, requires explicit confirmation, and is not installed as a
daemon or timer. An owner may separately define an exact-config system schedule
to invoke the same drain no more frequently than once per minute; each ticket
still needs its own landing-authority authorization and fresh exact-commit
receipts. The schedule cannot merge/converge worktrees, push remotes, or start
AI runtimes. Specialists do not push directly to the canonical branch.
External forge credentials can bypass this local queue, so branch
protection/credential isolation remains optional defense in depth rather than a
false claim of local enforcement.

## ADR-020: Current instruction rehydration on every resume

**Status:** accepted.

Every fresh start and resume composes a digest-addressed instruction bundle
from the canonical project checkout. TORCH delivers that current bundle through
the selected adapter's supported resume mechanism and exposes the same text and
digest in the Fleet brief. Current instructions override historical conversation
content, and agents re-read the current brief before each new work item. The
bundle is never sourced from a potentially stale specialist worktree. If an
adapter cannot apply the bundle, TORCH must disclose or block rather than claim
the resumed agent has current instructions.

## ADR-021: Hierarchy-aware manager check-ins

**Status:** accepted; organization-aware inspection, durable queue, typed
system-schedule dispatch, default Session Manager cadence, and an opt-in
adapter-mediated wake with an atomic project-wide daily invocation ceiling are
implemented. Installing a persistent timer and live provider qualification
remain gated.

Periodic check-ins derive each manager's direct reports from the active
organization graph. They inspect durable presence/task state, unacknowledged
coordination messages, and explicit approval waits; uncertain natural-language
summaries are not treated as approval facts. Approval requests persist with a
named requester and approver, task/evidence context, state, revision, and
decision metadata. Named AI approvers receive durable inbox messages and may
decide only their own requests; the configured owner decides through explicit
CLI confirmation. Decisions are audited and returned durably to the requester.
Manager check-ins classify direct-report requests by whether the manager, a
peer AI, or the owner must act; they route but never decide on another
approver's behalf. The check-in creates a durable,
bounded request for the manager to inspect and advance its reports. It never
approves, reassigns, edits backlog state, creates identities, or starts provider
sessions by default. If the manager is offline, the event remains queued. An
optional adapter-mediated wake is disabled by default; owner-reviewed schedule
configuration plus a project-wide budget can enable it with an atomic maximum
invocation count shared across manager schedules per UTC day. TORCH uses the configured identity adapter/profile and skips active
managers. This count ceiling is not equivalent to a USD spend ceiling. No
persistent timer is installed without owner approval. New
deterministic project proposals include one 15-minute system schedule for the
Session Manager. Additional manager identities require their own explicitly
configured check-in schedule; project configuration validation rejects an
explicit hierarchy that leaves a manager identity without one. Automatic
schedule generation follows hierarchy planning and activation; activation
surfaces schedule additions and obsolete candidates but does not install or
reconcile a system timer.

## ADR-022: Explicit fast-forward-only forge publication

**Status:** accepted.

Integration and forge publication are separate operations. Specialists submit
verified commits to TORCH's local FIFO integration queue; the landing authority
updates local canonical main. Publishing that landed canonical commit to an
attached forge requires a separate owner-confirmed `torch forge sync --yes`
after a read-only `torch forge sync plan`. TORCH pushes only the exact current
canonical commit with normal Git fast-forward semantics and records the
owner's action and observed result. It never force-pushes, fetches/merges
implicitly, or publishes from the integration drain or its timer. A remote-ahead
or divergent result blocks and requires explicit owner convergence. The
remote's compare-and-update semantics reject a race that advances its ref
after planning. Local integration remains available during forge outages.

## ADR-023: Organization-aware lifecycle ordering

**Status:** accepted.

Startup is topologically ordered by the active reporting graph after role
relationships are projected onto persistent Fleet identities. Managers start
before direct reports. Wind-down reverses that identity order and routes each
active identity's final status to its direct manager identities, preserving
bottom-up reporting as the fleet grows. An identity-level cycle or missing
manager blocks both plans; an acyclic role graph is not sufficient if multiple
roles collapse into a cyclic identity graph. A partial startup leaves already
started managers available for coordination and reports the exact identities
that did start; TORCH does not silently stop them or continue launching after a
failure. Planning alone never invokes a provider. Legacy
`session_manager.start_last: true` remains accepted in existing configs but is
ignored in favor of the active organization graph.

## ADR-024: Runtime reservation schema compatibility

**Status:** accepted.

Runtime reservation leases require control-plane schema version 3 or later.
An engine may migrate state that predates reservations, but it must refuse a
reservation-bearing database relabelled by an older engine and must refuse a
database with a newer schema. Runtime and Release must keep the reservation-
capable engine active for any project that has reservation state; rollback to
an older launcher is unsupported until an explicit, recovery-tested migration
exists. This is a compatibility boundary, not permission to install, activate,
or start a runtime.

## ADR-025: Reviewed reservation-state recovery and writer isolation

**Status:** proposed; design-only pending independent QA and Session Manager
review.

This decision records the recovery design required by
`TASK-125dd886-6859-4e3c-a0c7-abbfde9eac24`. It does not authorize an
installation change, a runtime start, a database mutation, a migration retry,
or another qualification gate.

### Observed writer inventory

The clean candidate `be1ae9511e74e3c4c7d8f3d3a5f1212b25c24cc2` has the only
reservation-aware initializer: `src/control-plane/service.mjs` declares schema
version 3, defines the twelve-column `runtime_launch_reservations` table, and
creates both its active-identity and unique-attempt indexes. Its CLI
(`src/cli.mjs`), MCP server (`src/mcp/server.mjs`), and Console server
(`src/console/server.mjs`) all open that control-plane service.

The current canonical checkout and installed active runtime are incompatible
writers. Canonical `src/control-plane/service.mjs` and active
`~/.local/share/torch/runtime/active` (a link to
`versions/0.1.0-alpha.2`) unconditionally execute `PRAGMA user_version = 2`
after their shared-table initializer. The installed `torch` launcher resolves
to that active alpha.2 runtime. Its CLI, MCP server, and Console server also
open their version-2 control-plane service. Any of those writers can relabel a
reservation-bearing database after the candidate has initialized it. A
reservation-aware candidate alone therefore cannot safely repair the state.

### Staged qualification without production-state migration

There is no non-circular native qualification path today. Every normal
candidate-CLI check opens the registered production state root before executing
its check, so it correctly stops at the downgrade guard. That failure must not
be bypassed to create a real-project receipt.

The first implementation phase is therefore limited to an isolated fixture:
it uses a unique `XDG_DATA_HOME`, a fixture installation and state root, and a
candidate-source executable. It may construct version-2 and version-3 fixture
databases and exercise the recovery planner/backup verifier there. Its outputs
are scoped source evidence only; they cannot be stored as, substituted for, or
promoted into any receipt for this project. The existing test fixtures already
support a distinct `XDG_DATA_HOME`; the registered manifest/state-root checks
ensure that such a fixture is not the production installation.

Only after independent QA accepts that isolated implementation may Release
propose a separately reviewed reservation-aware runtime installation and writer
fence. That activation is not authorized by this ADR. Once the fence is live,
the real project may take a fresh read-only plan, a separately authorized
consistent backup, and—only after another review—an apply. Full native gates
remain unavailable until that real state has been safely recovered; this
sequence reports the circular dependency instead of hiding it.

### Required read-only preflight and backup contract

The future recovery planner must first emit a digest-bound, read-only plan. It
must record the project manifest and `project.json` identities, repository and
runtime source hashes, active-launcher target, candidate commit, database file
and WAL/SHM hashes, and the exact observed writer set. It must reject an
unresolved or untrusted writer rather than infer that a process is absent. A
plan does not create a backup or change the database.

The plan must validate all of the following before it can name a database
recoverable:

- `PRAGMA integrity_check` succeeds and `PRAGMA foreign_key_check` is empty.
- The reservation table SQL, all twelve columns, and both expected indexes
  exactly match the schema-3 contract; a missing, extra, or substituted object
  is an incomplete-schema refusal.
- The recorded schema version is 2, the table is present, and every
  reservation-state count is zero. Any `starting`, `held`, `succeeded`,
  `failed`, or otherwise unrecognized row refuses recovery; held rows are
  never cleared or reclassified.
- Project identity, local-state path, and database provenance bind to the
  requested installation. A copied, forged, newer-than-supported, or
  cross-project database refuses recovery.
- The plan identifies the external backup destination and the source files to
  fingerprint, but does not copy them. A later backup phase must produce a
  consistent snapshot and immutable hash manifest before any future mutation.
  Backup success is necessary but never itself an authorization to apply
  recovery.

Writer isolation is a separate, independently verified prerequisite. The
future recovery implementation must verify a reservation-aware installed
engine and refuse while any alpha.2/canonical version-2 CLI, MCP, Console, or
arbiter-owned service can write this state root. A caller-supplied boolean or
free-text claim that executors are stopped is insufficient. Runtime/version
activation remains a separately owned and reviewed operation.

The required attestation is a Release-owned, installation-bound recovery fence,
not a process-list observation. Its verifier must bind the project and state
root, the approved reservation-aware runtime digest, retired writer digests,
the active launcher target, and an exclusive fence token. The fence begins
before plan-hash recheck, remains held through online backup and the apply
transaction, and remains enforced afterwards so an old writer cannot restart
and relabel the database. `BEGIN IMMEDIATE` protects the short database
transaction but is not a substitute for that lifetime fence. The apply phase
recomputes the source `state.db`/WAL/SHM hashes while the fence is held and
refuses if they differ from the plan. It then verifies a fresh immutable
snapshot rather than trusting volatile live file copies.

No such verifier or enforceable lifetime fence exists in the current alpha.2
installation. A state-root lock that the version-2 writers do not honor, a
stopped PID, or an unsigned attestation is not sufficient. Consequently, live
backup and live apply are deliberately unsupported until Release supplies and
independently validates this boundary.

### Proposed future interface (not implemented or invoked)

The supported path should be two explicit commands implemented only after
review:

```text
torch control-plane reservation-recovery plan --area project-kernel --target-schema 3 --json
torch control-plane reservation-recovery backup --plan <plan-digest> \
  --writer-attestation <trusted-fence> --destination <external-path> --yes --json
torch control-plane reservation-recovery apply --plan <plan-digest> \
  --backup-manifest <backup-digest> --writer-attestation <trusted-fence> --yes --json
```

`plan` is read-only. `backup` is a separate, explicit mutation: while the
trusted fence is held it must use Node's `node:sqlite` online `backup()` API to
write an external snapshot, then create an immutable manifest over the backup
and the fenced source inventory. Independent file copies of live
`state.db`/WAL/SHM are prohibited. `apply` must be unavailable until the plan,
immutable backup manifest, and a verifier-backed writer attestation all match
current state. In one immediate write transaction it must repeat every
validation, record an audit event, and only then advance the version label from
2 to 3. It must never create a missing reservation table, drop/rebuild an
index, delete a row, clear a lease, or accept a different schema shape as a
recovery shortcut. A changed hash, concurrent writer, or transaction contention
aborts without a partial relabel.

### Required deterministic scenarios before any implementation

- Empty, exact twelve-column version-2 reservation state plus a trusted
  reservation-aware writer produces a plan, backup manifest, and one atomic
  relabel only after a separately reviewed apply.
- A held row, active row, unknown state, nonzero data count, forged table SQL,
  missing/altered index, newer schema, or version-3 state missing its table
  refuses with no database change.
- A v2 writer attempt racing the plan/apply boundary invalidates the writer
  attestation or transaction precondition; recovery does not relabel and no
  duplicate runtime reservation is created.
- A forged caller evidence record cannot stand in for trusted writer isolation
  or a verified backup manifest.
- Candidate-source recovery tooling operating under an isolated fixture state
  root yields scoped evidence only; a normal candidate CLI pointed at the real
  manifest remains blocked until a separately reviewed fence and live recovery
  exist.

These scenarios are additive future QA work under the existing strict consent;
they do not relax ADR-024's fail-closed guard or change existing assertions.

## Consequences

These decisions keep the first usable release local-first and provider-
independent. They also make current boundaries explicit: repository moves,
multi-machine control, non-Linux persistent launchers, published update
channels, and measurement/adoption of live multi-level organization pilots
remain unavailable or owner-gated rather than silently approximated.

## ADR-026: Proposed candidate-source qualification contexts and receipt authority

**Status: proposed, nonnormative design contribution pending Work, Release, QA,
and owner review. This ADR makes no implementation, policy, gate, schema, or
receipt-validity change.**

### Context

Candidate checks must be able to qualify a clean, unlanded source commit
without initializing a live control plane. A single engine digest is not enough
to establish what was checked, whether it may write a receipt, or whether the
result describes candidate source versus an installed operational runtime.
Conversely, the schema-2-to-schema-3 refusal protects live registered state and
must not be bypassed by fixtures, alternate roots, or a source runner.

### Proposed direction

A future versioned result would bind three independent axes. **Engine
provenance (E)** is the exact engine source commit, module path,
dependency-resolution and source-tree digests, runtime/build bytes, and
interface version. **Subject scope (S)** is the authenticated clean product
commit or installed operational runtime, with immutable
`subjectProductStorageSchemaDigest` (or explicit null) as subject metadata.
**Receipt authority (A)** is the adapter identity/digest/interface, declared
compatible registered receipt schemas, `registeredReceiptSchemaVersion`, and
`observedControlPlaneSchemaVersion`. E is independently recorded and is not
presumed to equal S's product commit. The exact tuple would also include
protocol version, registered project/install identity, frozen definition and input snapshot digests,
guard/resource binding, durable attempt identity, sealed artifact-manifest
digest, and actual terminal outcome. Product-storage schema metadata is not a
registered receipt/control-plane schema change.

The Kernel would derive a native candidate context from the registered
manifest/root, registered area, and exact clean managed candidate, rather than
accepting caller paths, manifests, database handles, receipt adapters, commits,
or an initial expected commit as authority. The proposed candidate engine would
not initialize `ControlPlane`. A separately versioned registered adapter would
validate the tuple and compatible schema before performing receipt DML; the
adapter would not perform DDL, migration, schema relabel, or root redirection.
A future product-schema-3 subject can be considered with genuinely pure,
schema-agnostic engine bytes and an authenticated schema-2-compatible adapter
only when the reviewed tuple explicitly supports it. The current candidate
CLI/engine actually initializes `ControlPlane`, requires schema 3, and must
continue to refuse against registered schema 2. This is tuple-specific: valid
schema-2 legacy source receipts remain valid under their recorded compatible
adapter contract and are not retroactively invalidated or promoted.

Fixture execution would use a separately authenticated fixture identity,
manifest/root, and XDG state. It may return a permanently nonpromotable
`SourceAttestation/v1`, never a registered receipt. It cannot be copied or
relabeled into registered receipt storage, and Integration, Backlog, and
Delivery would not consume it as a gate result.

The proposed worker transport is an adapter-created opaque fresh single-use
attempt with a dedicated artifact directory. The worker would receive only a
verified immutable snapshot, frozen definition, bounded arguments, an explicit
environment allowlist, and per-attempt `HOME`, `TMPDIR`, and XDG homes; it
would receive neither registered root/manifest/database locations nor provider
credential variables. The adapter-owned collector would accept regular files
only below the attempt directory, reject links and traversal, and seal a hashed
artifact manifest.

The proposed lifecycle is durable guarded-attempt creation, execution over one
opaque worker transport, adapter observation of an actual terminal outcome,
manifest sealing, and an atomic transaction that consumes the attempt while
persisting terminal evidence after full tuple revalidation. A fully revalidated
`PASS` inserts its registered receipt in that same transaction; non-PASS
terminal evidence is retained for observability but cannot qualify a passing
gate. `PASS`, `FAIL`, and proven `INCOMPLETE` stay distinct. A non-proven
interruption, cancellation, or ambiguous commit is
`UNKNOWN`: it creates no receipt, is not consumed-and-lost, retains its guards
and evidence, and permits neither automatic replay nor automatic release.
Consumed or replayed identifiers fail closed.

These withheld capabilities are an authority boundary, not an OS filesystem
sandbox. They stop the proposed interfaces from granting registered-root or
receipt-writing authority, but do not independently contain same-user code that
can discover ambient host state.

### Unresolved decisions

- The initial CLI subject rule is constrained: derive registered area and clean
  managed subject internally; accept no caller selector or initial
  expected-commit. A future reviewed expected-commit value could only reject a
  mismatch against that derived subject. Release still must decide command
  naming, presentation/refusal surface, and the primary `src/cli.mjs` boundary.
- QA must approve strict candidate, native, fixture-nonpromotion,
  schema-incompatibility, single-use, replay, no-DDL, terminal-outcome, and
  unknown-interruption scenarios before implementation.
- Durable store choice, guard/fence ownership, process isolation, environment
  exceptions, artifact sealing/transport, credential treatment,
  cancellation/recovery behavior, replay implementation, and adapter support
  for historical receipt layouts remain unselected.

### Consequences

This proposal preserves ADR-024's fail-closed schema compatibility and
ADR-025's recovery boundaries. It does not authorize live recovery, a schema
change, an installation change, a provider start, automatic wake activation, or
an integration decision.
