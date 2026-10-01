# TORCH Portable Agent Fleet Specification

Status: Draft for implementation

Version: 0.1

Date: 2026-09-27

Product: TORCH
Reference implementation: COMBATRIG agent fleet

## 1. Document authority

This document is the canonical product and architecture specification for the
new TORCH.

It consolidates the requirements developed in the conversation exported as:

`/home/user/Downloads/ChatGPT-Document Portable Fleet System-20260927-1435.md`

The conversation is design provenance, not an additional specification. When
the conversation contains multiple versions of an idea, its later decisions
take precedence and this document records the consolidated result.

The working COMBATRIG fleet is the behavioral reference. Its operational
lessons and proven invariants should be preserved, but its project-specific
paths, prompts, model assignments, resource rules, release commands, and
Claude-specific mechanisms are not portable requirements.

This specification supersedes the existing TORCH Nostr lock/scheduler product
and the `v2/development-network` direction. Those systems are legacy products;
their protocols, funding model, relay architecture, scheduler, dashboard, and
implementation seams are not constraints on the new TORCH.

Normative terms have their usual meanings:

- **MUST** and **MUST NOT** are required for conformance.
- **SHOULD** and **SHOULD NOT** are recommended unless a documented project
  constraint justifies a different choice.
- **MAY** is optional.

## 2. Product definition

TORCH turns a Git repository into a persistent, coordinated team of
domain-specialized AI development sessions.

One human owner primarily works through one configured owner-facing
coordination role. The initial role is the Session Manager. A larger approved
organization may place a Program Director between the owner and operational
coordination, while Fleet Operations and domain leads retain their defined
responsibilities. Persistent implementation domains have stable identities,
explicit ownership, dedicated Git branches and worktrees, known neighbors,
required verification, and durable restart state. TORCH supplies the control
plane that lets these sessions coordinate across different agent runtimes
without making any one runtime the definition of the fleet.

The product promise is:

> A developer with a Git-capable laptop and access to a coding model can run a
> persistent, coordinated, multi-agent software engineering organization
> without depending on GitHub or any other development platform.

TORCH is not merely a prompt collection, terminal launcher, task lock, agent
catalog, or wrapper around one model vendor. It is a lightweight development
control plane with project analysis, organizational configuration, isolated
execution, durable coordination, verification, integration, and recovery.

## 3. Goals

TORCH MUST:

1. install into an existing or new Git repository;
2. analyze that repository before proposing an organization;
3. obtain human approval before creating permanent domains or worktrees;
4. create stable domain identities with explicit `scope` and `notScope`;
5. give each persistent development domain its own branch and worktree;
6. provide one primary owner-facing coordination conversation;
7. support direct peer coordination while respecting the authority assigned to
   each role in the approved organization;
8. externalize identity, ownership, backlog, decisions, unfinished work, and
   restart instructions so conversation context is not the database;
9. expose the same organizational tools to Claude, Codex, OpenCode, and future
   runtimes through adapters;
10. operate in a local-only configuration with no forge, hosted CI, hosted
    database, or external message queue;
11. support optional forge, CI, issue, release, and deployment adapters;
12. verify changes against exact Git commits before integration;
13. coordinate scarce shared resources explicitly;
14. install, detach, uninstall, upgrade, and roll back safely;
15. manage development of its own successor from a stable installed release;
16. re-import COMBATRIG without special-case orchestration code;
17. preserve domain-local context as a focused working set instead of forcing
    one general session to repeatedly evict and reload unrelated project areas;
18. let an owner reshape the coordination hierarchy as a project grows, while
    keeping the smallest organization that can coordinate its work effectively.

### 3.1 Context locality and the hot-cache hypothesis

Persistent domain sessions SHOULD keep the context most relevant to their
owned area warm: architecture, recent changes, decisions, failure modes,
neighbors, and active backlog. The Session Manager keeps routing and fleet
state rather than absorbing every domain's implementation detail. This
partitioning is expected to reduce context churn when the project switches
between unrelated tasks and may reduce provider cache reads, cache writes,
input tokens, latency, and cost.

This is a product hypothesis, not yet a performance claim. TORCH MUST keep
durable project truth outside model context, and SHOULD measure comparable
single-session and persistent-domain workflows before advertising savings.
Measurements SHOULD record, where a runtime exposes them:

- uncached and cached input tokens;
- cache creation/write and cache read tokens;
- prompt size at fresh start and resume;
- time and turns to first useful action after a task switch;
- context compactions or reloads;
- cost per completed, verified backlog item;
- quality or rework regressions that could invalidate a cheaper run.

Telemetry MUST be local and opt-in unless project policy explicitly selects an
external sink. TORCH MUST distinguish measured provider data from estimates.

## 4. Non-goals

The initial product is not required to:

- recreate GitHub, GitLab, or a general-purpose forge;
- replace Git itself;
- provide social coding, public profiles, or human code-review workflows;
- provide its own foundation model;
- guarantee that every runtime exposes identical native session controls;
- automatically resolve merge conflicts;
- silently invent a domain organization without human review;
- automatically merge active worktrees on a timer;
- deploy project code without project-defined authority;
- preserve compatibility with the legacy Nostr TORCH APIs;
- launch the largest possible number of agents.

The number of agents is an output of repository analysis and project need, not
a product success metric. Idle is a valid fleet state.

## 5. Core invariants

Every conforming implementation MUST preserve these invariants:

1. One persistent development domain maps to one persistent worktree.
2. Every domain has explicit ownership and explicit exclusions.
3. Every domain has a stable Fleet identity independent of runtime session ID.
4. The human has one primary fleet-facing conversation.
5. Configured organizational roles control routing, priority, and ownership
   rulings only within their approved authority; the Session Manager retains
   fleet-operations responsibility unless an approved change says otherwise.
6. Peers may coordinate directly but may not grant themselves authority.
7. Repository state outranks model memory and chat history.
8. Live messages are transport, not the sole durable record.
9. Unfinished work is externalized before shutdown.
10. A session never edits another session's worktree.
11. A persistent Fleet branch is merged, never rebased by automation.
12. A running measurement is never changed underneath itself.
13. Shared resources have explicit capacity and fairness policies.
14. Verification results name the exact commit they measured.
15. Integration and deployment are separate states.
16. Scheduled work declares whether it survives AI-session shutdown.
17. Monitoring may be automatic; worktree mutation is intentional.
18. Secrets never enter tracked Fleet state.
19. The installed TORCH engine is never sourced from the repository it is
    currently managing.
20. Every installation is exactly reversible within declared safety limits.
21. Stable TORCH can manage development and release of its successor.
22. Provider integrations reinforce TORCH policy; they do not define it.
23. Organizational reporting relationships never silently transfer
    implementation ownership or grant authority.

## 6. Terminology

**Owner**

The human authority for the project. The owner approves the organization,
high-impact policy, deployments, destructive actions, and other decisions
reserved by project configuration.

**Fleet**

The complete TORCH-managed organization for one project.

**Session Manager**

The initial persistent dispatcher and fleet-operations identity. In the
starting organization it receives owner requests, routes work, establishes
ownership and ordering, monitors fleet health, and reports decisions or risks.
If the owner approves a higher coordination layer, the Session Manager's
responsibilities may be divided with a Program Director while its operations
identity remains stable.

**Domain manager**

A persistent specialist assigned to an architectural concern or operational
responsibility. A domain manager is staff; temporary subagents are helpers.

**Runtime**

The agent harness used to host a session, such as Claude Code, Codex, OpenCode,
Pi, or another locally available agent system. Runtime selection is per
persistent identity, not one project-wide provider choice.

**Runtime adapter**

The implementation that maps TORCH session operations to one runtime. Adapters
may be built in or installed as local plugins, and must report capabilities
honestly.

**Control plane**

The provider-independent service for identity, roster queries, presence,
messaging, acknowledgements, handoffs, status, backlog coordination, and
resource leases.

**Canonical branch**

The shared integration branch, normally `main`.

**Canonical Git store**

The Git repository considered authoritative for shared refs. It may be a local
bare repository or a network remote.

**Forge**

An optional service such as GitHub, GitLab, Forgejo, Gitea, or Bitbucket.

**Convergence**

The intentional process of bringing current canonical-branch state into a
domain branch and re-verifying the combined result.

**Check receipt**

A durable record of a check command, inputs, result, and exact tested commit.

**Integration request**

A request to land a tested domain commit onto the canonical branch.

## 7. System architecture

TORCH has four logical layers:

```text
┌─────────────────────────────────────────────────────────┐
│ Project                                                 │
│ Source, tests, assets, docs and project configuration   │
└───────────────────────────▲─────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────┐
│ Fleet engine                                            │
│ Analysis, roster, worktrees, backlog, checks, doctor,   │
│ resources, convergence, integration and lifecycle       │
└───────────────────────────▲─────────────────────────────┘
                            │
┌───────────────────────────┴─────────────────────────────┐
│ Communication control plane                             │
│ Identity, presence, ownership, messages, acknowledgments│
│ handoffs, status and session registry                   │
└───────────────┬────────────────┬────────────────────────┘
                │                │
        ┌───────▼──────┐ ┌──────▼───────┐ ┌────▼─────┐  ...
        │Claude adapter│ │ Codex adapter │ │Pi adapter│
        └──────────────┘ └──────────────┘ └──────────┘
```

The installed engine MUST expose one internal service layer. The CLI, MCP
server, local console, and automation hooks MUST call that service layer rather
than implement separate business rules.

MCP is a primary agent-facing interface, but it is not TORCH's internal data
model. A CLI fallback MUST exist for runtimes or environments without MCP.

## 8. Installation and filesystem model

### 8.1 Installed engine

Most TORCH implementation code MUST live outside managed repositories. A
typical user installation is:

```text
~/.local/bin/torch
~/.local/share/torch/
    versions/
    adapters/
    projects/
```

The first implementation MAY require Node.js 22 or later. Packaging as a
standalone executable is a later distribution goal and MUST NOT change project
configuration semantics.

The tracked `.torch/` namespace may already contain unrelated owner data from
another tool or an earlier workflow. Installation may overlay only when every
TORCH-owned target path is new and trackable by Git. It MUST refuse an ignored
tracked configuration path, unsafe directory node, or existing ownership
manifest. Reversal removes only manifest-owned files and directories created by
that installation; pre-existing `.torch/` content survives byte-for-byte.

### 8.2 Tracked project state

The project owns its durable organizational memory under `.torch/`:

```text
.torch/
    torch.yaml
    roster.yaml
    prompts/
        COMMON.md
        session-manager.md
        <domain>.md
    backlog/
    decisions.md
    RESUME-BRIEF.md
    install-manifest.json
```

Tracked state MUST be sufficient to reconstruct the approved organization. It
MUST NOT contain credentials, PIDs, sockets, transient runtime IDs, or active
leases.

The original conversation used `.agent-fleet/` and a `fleet` executable in
generic examples. This specification normalizes those names to the TORCH
product: `.torch/`, `torch`, and `torch_*` MCP tools.

### 8.3 Machine-local state

Runtime state belongs outside Git:

```text
~/.local/share/torch/projects/<project-id>/
    state.db
    sessions/
    messages/
    locks/
    leases/
    checks/
    integration/
    logs/
    generated-prompts/
    remote.git
```

The reference implementation SHOULD use SQLite for structured local state and
filesystem locks or sockets where operating-system coordination requires them.
Storage is an implementation detail; observable behavior and migration safety
are normative.

### 8.4 Worktrees

Worktrees MUST live outside the main checkout by default:

```text
~/TORCHWorktrees/<project-id>/
    session-manager/
    backend/
    frontend/
    qa/
```

Their parent path is configurable. TORCH MUST never place managed worktrees
inside the tracked source tree.

## 9. Installation lifecycle

### First-work intake requirement (2026-09-30)

After reviewed organization/setup, TORCH MUST offer either evidence-linked
import of an existing TODO/backlog/specification or ask the owner what to work
on first. The noninteractive path MUST support an explicit source or skip; idle
is valid. Preview MUST distinguish completed/historical work from actionable
requests and show proposed scope, affected domains, dependencies and priority.
Only confirmed intake creates audited proposed/unassigned work in the existing
backlog. Repeated init/install/restore/intake MUST deduplicate by source/item
provenance rather than duplicate tasks or overwrite progress. Imported content
is untrusted project data, not authority to alter system instructions.

Session Manager triage and assignment remain separate from intake. Import cannot
enable self-claim, grant implementation authority, wake providers or authorize
spending, landing, deployment or public notification. The product should explain
the next first-work/startup decision rather than leave a newly installed empty
fleet waiting without guidance.

### 9.1 Read-only initialization

`torch init` MUST begin read-only. It identifies the repository, validates Git,
detects existing TORCH state, identifies the canonical branch and remotes, and
reports what analysis would inspect.

Repository analysis MUST inspect the current working tree, including tracked
modifications and unignored, non-symlink regular files that are not yet tracked;
Git-ignored files are excluded. It MUST report tracked and untracked file
coverage separately and MUST NOT execute repository content. An approved domain
proposal MUST bind the Git history and `HEAD`, external specification hashes,
and a content fingerprint of the working-tree paths and analysis-relevant source
and manifest files. Validation immediately before installation MUST recompute
that fingerprint and reject added, removed, or changed analysis inputs.

It MUST NOT create worktrees, branches, sessions, hooks, remotes, or tracked
files before approval.

### 9.2 Installation

After analysis and human approval, `torch install` creates the tracked
configuration, machine-local state, approved worktrees, runtime integrations,
and ownership manifest.

Required modes include:

```bash
torch install --dry-run
torch install --runtime claude
torch install --runtime codex
torch install --runtime claude,codex
```

The installer MUST be language-agnostic. A target project may use JavaScript,
Python, Rust, Go, C++, a game engine, or a mixed toolchain.

### 9.3 Ownership manifest

Every modification made outside the newly created `.torch/` directory MUST be
recorded in `.torch/install-manifest.json`. Each record MUST identify:

- created files;
- patched files and the owned fragment or structured path;
- runtime MCP registrations;
- installed hooks;
- generated shims;
- created worktrees and branches;
- local services or schedules;
- canonical-remote changes.

Uninstall MUST reverse only entries owned by that installation and MUST detect
user changes before reversing a patch.

### 9.4 Detach and uninstall

`torch detach` stops runtime integration while preserving the organization,
tracked state, and worktrees.

`torch uninstall` stops managing the repository and removes owned runtime
integrations. It SHOULD preserve `.torch/` for easy restoration.

`torch uninstall --purge` additionally removes tracked TORCH configuration
after explicit confirmation and safety checks.

No uninstall mode may delete or remove a worktree containing:

- uncommitted changes;
- an in-progress Git operation;
- commits absent from the configured recoverability boundary;
- an active check or measurement;
- an unresolved resource lease.

Uninstall MUST stop before destructive cleanup and report exact remediation.

Implementation checkpoint (2026-09-27): CLI purge requires both `--purge` and
explicit `--yes` after a dry-run review. Reversal validates the manifest's
machine-local state path against the project ID and current XDG environment,
allows TORCH-owned historical database and evidence files, and fails closed on
unknown state entries, active runtime identities, local locks, resource leases,
worktree guards, in-flight landing, unsafe worktrees, unique canonical history,
or installed persistent launchers. Historical messages and receipts therefore
do not make reversal permanently impossible, while active or unowned state
still blocks deletion.

Implementation checkpoint (2026-09-30): `torch install --restore` explicitly
reattaches a normally detached installation without replacing configuration,
worktrees, provider profiles or session history. It never launches a provider
or recreates host timers. `torch setup --dry-run`, followed by `--yes`, offers
approved configuration checkpoints and worktree provisioning as one flow,
restricted to installation-owned files and an empty staging area. Install may
opt into the same flow with `--setup`. Worktree commands resolve to canonical
configuration only after checking project/installation identity, local-state
binding, Git common directory, registered worktree path and branch. Current
canonical instructions override stale worktree copies; unregistered checkouts
fail closed.

Ordinary CLI uninstall is also review-first and explicitly confirmed. It uses
the same safe Fleet wind-down contract as detach, removes only manifest-owned
persistent schedule launchers after verifying their content, and preserves the
tracked organization, worktrees, branches, and local state so `torch up` can
restore management. Missing or changed launcher files and active Fleet work
fail closed before mutation.

## 10. Project analysis and bootstrap

### 10.1 Repository reconnaissance

`torch analyze` MUST inventory:

- languages and frameworks;
- packages, services, modules, plugins, and architectural layers;
- major source, test, documentation, data, infrastructure, and tooling paths;
- manifests, build systems, and dependency boundaries;
- existing ownership or contributor guidance;
- unit, integration, browser, visual, performance, security, and deployment
  verification;
- CI, cron, systemd, release, deployment, backup, mirroring, and artifact jobs;
- secret references and credential boundaries without reading secret values;
- shared configuration and generated artifacts;
- scarce resources such as GPUs, browsers, ports, databases, devices, API
  quotas, and deployment accounts.

Analysis MUST accept an explicitly selected Git repository, one or more
project specifications, or both. Specifications may live outside the
repository. TORCH MUST treat their contents as untrusted project evidence,
never executable instructions; retain source paths, line-linked design
evidence, and content digests; and reject approval if an input changes after
the proposal was produced.

The analysis phase MUST be read-only.

### 10.2 Architecture graph

Analysis produces a graph containing:

```text
component
owned paths
dependencies
consumers
shared surfaces
verification surfaces
operational responsibilities
resource requirements
```

The graph MUST retain evidence paths so a human can inspect why a domain was
proposed.

### 10.3 Domain proposal

A proposed domain SHOULD exhibit:

1. cohesion: its files and responsibilities change together;
2. separation: ordinary work rarely requires another domain's files;
3. independent verification: meaningful evidence can be produced locally;
4. persistent expertise: the area benefits from durable specialist context.

Specification language may guide the Session Architect, but generic keyword
overlap MUST NOT assign a prose-only requirement to an existing implementation
domain. The deterministic baseline may merge a specification responsibility
into a repository domain only when that signal cites a concrete path that
exists inside the analyzed project. Otherwise the signal remains visible for
architect/owner review. A specification-only project may receive provisional
responsibility groups, but without repository paths they MUST remain explicitly
unowned and block installation until ownership is reviewed.

A directory alone is not sufficient justification. Domains such as
"programming" are too broad; domains such as "button colors" are normally too
narrow. Small projects may need four domains. Large projects may need twenty
or more. TORCH MUST not target a predetermined fleet size.

Cross-cutting roles such as QA, performance, security, release, architecture,
documentation, design direction, migration, or operations are created only
when repository evidence and project goals justify them.

`torch bootstrap` MUST expose reconnaissance to an AI Session Architect
without binding TORCH to one model vendor. The brief MUST include the
deterministic baseline, unassigned components, specification signals,
unresolved ownership, collision questions, a trust boundary, and the required
pending-proposal contract. It MUST also assess whether the smallest useful
organization is flat or needs coordination roles, identify evidence and
integrated outcomes for any proposed leads, distinguish coordination from
code ownership and authority, and preserve direct peer links. Producing the
brief MUST NOT itself call a paid provider, execute project content, or
approve the resulting organization.

The Session Architect output MUST include a pending `organization_assessment`
that chooses `flat` or `coordination_roles`, states its rationale, and cites
evidence present in the brief. It MUST name proposed coordination roles only
when the evidence supports an integrated outcome; each role MUST state the
domains it coordinates, its bounded decision scope, decisions escalated to the
owner, and evidence. A coordination role MUST NOT receive implementation paths
or owner-approval authority. The assessment MUST separately describe
implementation ownership, coordination responsibility, fleet-operations
authority, project-priority authority, independent-review authority, and
owner-only decisions. It MUST preserve direct peer communication. These
recommendations are advisory: persistent role creation or graph changes use the
separate owner-approved Fleet evolution or hierarchy-pilot flow.

`torch architect plan` MUST show the selected provider, model, isolation,
structured-output schema, prompt size, and budget boundary without invoking a
model. `torch architect run` MUST require explicit quota authorization, isolate
the planning session from project rules and write tools, and retain the
proposal as pending. Before presenting the result for owner review, TORCH MUST
reject changed repository/specification bindings, invented path ownership,
unknown evidence, checks, resources, runtimes, or schedules, and any attempt
by the model to approve its own proposal. Claude and Codex are reference
planning adapters; the validation contract remains provider-independent.

### 10.4 Collision analysis

For every proposed pair of domains, TORCH MUST identify likely collisions:

- files both might edit;
- APIs joining the domains;
- shared schemas and configuration;
- tests spanning both;
- shared generated outputs;
- shared external resources.

Each significant collision requires one declared resolution:

1. redraw the boundary;
2. designate one owner;
3. define a shared-file protocol;
4. create an integration responsibility;
5. require Session Manager coordination.

Collision analysis generates `notScope`, `neighbours`, shared-surface rules,
and coordination requirements.

### 10.5 Human review

TORCH presents the proposed organization before mutation. The owner may accept,
merge, split, rename, add, or remove domains; change ownership; change
authority; approve an optional hierarchy and role relationships; or reject the
analysis. The default is the smallest useful organization, not the largest
proposal the model can justify.

Permanent identities, branches, worktrees, and sessions are created only from
an approved proposal.

For a specification-first project, TORCH MAY propose responsibilities before
source paths exist, but it MUST label unresolved ownership and block
installation until the owner supplies defensible path boundaries. It MUST NOT
invent ownership merely to make a proposal installable.

### 10.6 Generated configuration and prompts

For each approved domain TORCH generates:

- stable ID and display name;
- purpose and scope;
- explicit `notScope`;
- owned and shared paths;
- neighbors;
- worktree and branch mapping;
- required checks;
- resource needs;
- authority and landing permissions;
- runtime and model policy;
- project invariants;
- initial backlog and first-move instructions.

Prompts MUST be derived from configuration and recorded decisions. Generated
prose MUST NOT become a competing source of truth.

Implementation checkpoint (2026-09-27): initial installation and later
owner-approved domain activation share one deterministic domain-prompt
renderer. Every generated briefing externalizes responsibilities, owned and
shared paths, exclusions, neighbours, required checks, scarce resources,
authority limits, project invariants, an explicit empty initial-backlog state,
and first-move instructions. Runtime prompt composition still combines this
reviewable domain materialization with the common Fleet rules.
Generated specialist instructions MUST distinguish domain-specific required
checks from project-wide integration gates. Every specialist receives the
exact configured project-gate IDs and command/argument vectors; this visibility
MUST NOT imply code ownership over those gates or derive a test assignment from
keyword overlap.

Every start and resume MUST rebuild the effective instruction bundle from the
current canonical project checkout, not a possibly stale worker worktree copy.
TORCH records a content digest, supplies the bundle to the selected runtime on
resume using that adapter's supported mechanism, and makes the digest visible in
`torch brief --area <identity> --json`. Before taking each new backlog item, an
identity MUST read the current brief. The latest canonical instructions override
older conversation history; a restart prompt is a pointer to current policy,
not a second policy source. The adapter's resume path must fail closed or
explicitly report when it cannot deliver the current bundle.

Fleet startup order MUST be derived from the active organization graph so
manager identities launch before their direct reports. Wind-down MUST use the
reverse identity-level order and deliver each active identity's final status to
its direct reporting manager identities, rather than routing every report to a
hard-coded Session Manager. Ordering is computed across roles bound to the same
persistent identity; if collapsing an acyclic role graph creates an identity
cycle, or a non-owner manager identity is absent from the roster, startup and
wind-down plans MUST fail closed. Selective startup preserves the relative
order of selected identities and may intentionally omit managers. Planning
these sequences MUST NOT itself start or stop runtimes. Legacy
`session_manager.start_last: true` values are accepted for compatibility but
ignored; the organization graph is authoritative.

### 10.7 Worktree creation

For every persistent development domain, TORCH creates or verifies a branch
and worktree. A default mapping is:

```text
domain ID: backend
branch:    torch/backend
worktree:  <worktree-parent>/<project-id>/backend
```

The branch naming convention is configurable. TORCH MUST verify that each
worktree maps to the intended branch, that its task marker is ignored, and
that the briefing system resolves the correct identity.

### 10.8 Bootstrap acceptance test

Installation is incomplete until TORCH proves:

- every domain has configuration, prompt, branch, and worktree;
- stable identities are unique;
- every live runtime session has a unique runtime ID;
- each worktree receives the correct brief;
- presence appears in the registry;
- doctor sees every worktree;
- the Session Manager can message every live domain;
- neighboring domains can exchange and acknowledge a message;
- ownership lookup returns the approved owner;
- backlog items can be created, assigned, updated, and closed;
- check recording binds results to a commit;
- resource capacity and queue behavior work;
- capture, shutdown, and restart preserve Fleet identity;
- uninstall dry-run accurately describes reversal.

## 11. Configuration model

`.torch/torch.yaml` is the primary machine-readable project configuration.
Roster and prompt files may be separate for reviewability, but they MUST be
generated or validated against this configuration and approved decisions.

Illustrative configuration:

```yaml
schema: torch.dev/v1alpha1

project:
  id: acme
  name: Acme
  main_branch: main

paths:
  tracked_state: .torch
  worktree_parent: ~/TORCHWorktrees

repository:
  canonical:
    type: local
    path: ~/.local/share/torch/projects/acme/remote.git

forge:
  provider: none

session_manager:
  id: session-manager
  runtime: claude
  landing_authority: true

git:
  branch_prefix: torch/
  convergence: merge
  allow_rebase: false
  allow_force_push: false
  allow_bare_stash: false

synchronization:
  strategy: dispatcher-managed
  auto_merge_worktrees: false
  observe_every: 60m
  converge:
    on_task_complete: true
    before_integration: true
    on_restart: true
    when_idle_and_stale: true
  defer_when:
    dirty: true
    mid_git_operation: true
    check_running: true
    measurement_running: true
    pinned: true

resources:
  browser:
    capacity: 1
    queue: fifo
  gpu:
    capacity: 1
    queue: fifo

checks:
  fast:
    command: npm test
  integration:
    command: npm run test:integration
  visual:
    command: npm run test:visual
    resource: browser

integration:
  provider: torch
  target: main
  require_current_main: true
  required_checks: [fast, integration]
  landing_authority: [session-manager]

schedules:
  doctor:
    owner: session-manager
    lifetime: session
    every: 60m
  session-manager-check-in:
    owner: session-manager
    lifetime: system
    every: 15m
    behavior: coordination
    action: manager-check-in
    manager_id: session-manager

release:
  provider: filesystem
  authority: owner

domains:
  - id: backend
    title: Backend systems
    runtime: codex
    scope: [API, persistence services]
    not_scope: [web UI, deployment]
    owned_paths: [src/server/**]
    shared_paths: [src/shared/schema/**]
    neighbours: [frontend, database, qa]
    required_checks: [fast, integration]
```

Configuration schema evolution MUST be versioned and migratable. Unknown
required fields MUST fail clearly rather than be silently ignored.

## 12. Organizational model

### 12.1 Starting Session Manager

In the current one-level organization, the Session Manager combines owner
dispatch with Fleet Operations and normally does not implement product
features. TORCH may later divide strategic coordination from operations only
through the approved hierarchy-change process. The starting Session Manager:

1. receives owner requests and preserves their original meaning;
2. identifies the owning domain or domains;
3. establishes priority, ordering, and shared-surface authority;
4. creates or updates durable backlog records;
5. sends actionable instructions to domains;
6. coordinates neighboring agents and dependencies;
7. verifies claims about shared state before relaying them;
8. monitors worktrees, sessions, resources, and integration readiness;
9. manages convergence and landing according to policy;
10. reports decisions, risks, blockers, milestones, and review-ready outcomes
    to the owner.
11. detects recurring or unowned work that may justify a new persistent domain;
12. proposes evidence-backed domain additions, merges, splits, or retirements,
    including expected context-locality benefit and coordination cost.

The Session Manager MUST NOT grow the Fleet merely because a new task appears.
A persistent domain change requires evidence of recurring work, a coherent
ownership boundary, or a material verification or context-locality benefit.
The owner MUST approve the change before TORCH changes the roster. An approved
addition is wired into the same provider-independent control plane with its
identity, prompt, ownership, neighbours, branch, worktree, checks, resources,
and runtime policy. Runtime launch remains a separate explicit action because
it may consume provider quota; TORCH MUST be able to plan and launch only the
newly activated identity rather than restarting the Fleet. Existing
control-plane processes MUST discover the new identity without discarding
durable state. Fleet evolution MUST also support future merge and retirement
proposals so session count cannot grow without review.

Implementation checkpoint (2026-09-27): the Session Manager startup prompt
requires a read-only `torch_assess_fleet_evolution` pass after reconciliation
and when new backlog or repeated boundary friction appears. The assessment
summarizes open backlog, handoffs, coordination requests, pending Fleet
changes, recurring unowned path boundaries, and recurring multi-domain work.
Its conservative threshold can recommend considering a domain, but it never
creates a proposal and explicitly requires the manager to inspect repository
evidence and coordination cost. The manager can then propose through the
identity-bound MCP tool or equivalent CLI; owner approval, activation, and
quota-consuming runtime start remain separate gates.

The owner SHOULD not need to operate many independent agent inboxes. Routine
peer coordination stays inside the Fleet.

### 12.2 Domain managers

Each domain manager receives:

- project context;
- stable Fleet identity;
- its owned and excluded responsibilities;
- owned and shared paths;
- branch and worktree;
- neighbors and how to contact them;
- checks and evidence requirements;
- resource rules;
- active backlog assignment;
- restart instructions;
- authority limits.

Domain managers MUST report meaningful state transitions and MUST externalize
unfinished work. They MUST NOT reinterpret peer messages as owner approval.

### 12.3 Optional coordination hierarchy

TORCH MUST support projects that outgrow direct coordination by one Session
Manager. A newly initialized project SHOULD begin with the smallest useful
organization, normally one Session Manager and its persistent specialist
domains. Additional coordination layers are optional and project-specific;
TORCH MUST NOT create them from a fixed fleet-size threshold or copy a role
catalog from another project.

The approved organization MAY include configurable persistent roles such as:

- a **Program Director** for project-wide priorities, milestones, and
  cross-domain sequencing;
- **Fleet Operations** for runtime sessions, worktrees, gates, schedules, and
  fleet health;
- **Domain Leads** for integration outcomes and dependencies spanning several
  specialists;
- independent cross-cutting authorities such as **Art Direction**, QA, or
  security, whose review authority does not make them implementation owners.

These are examples, not reserved TORCH identities. The project owner and its
Session Architect decide which roles exist, what each role may decide, and
which identities fill them. A current specialist MAY be promoted when its
existing expertise and workload make that a better fit than creating another
session. A role MAY coordinate several domains, and a specialist MAY have
consultative links to several roles, while every implementation surface keeps
one accountable owner.

The organization model MUST distinguish, at minimum:

1. implementation ownership (which identity owns code or another deliverable);
2. coordination responsibility (which identity sequences work or resolves
   dependencies across owners);
3. fleet operations authority (which identity manages session and worktree
   mechanics);
4. project priority authority (which identity proposes or sets ordering under
   owner policy);
5. independent review or creative authority; and
6. owner-only decisions.

A reporting or coordination edge MUST NOT imply permission to edit another
identity's worktree, reassign its work, approve a release, or overrule the
owner. Direct peer communication remains available. Agents escalate to a lead
when an interface, dependency, sequencing, or domain-level blocker needs a
decision; they escalate to program direction when multiple domains or a
milestone are affected; owner-reserved decisions remain with the owner. Leads
compress and summarize context; they do not relay every routine message.

### 12.4 Evidence and approval for hierarchy changes

TORCH MUST let the fleet propose and plan organizational changes that add a
coordination role, promote an existing identity, change which domains a lead
coordinates, separate or combine management responsibilities, or retire a
role. The existing single backlog remains the task ledger and queue. Program
and domain artifacts MAY summarize priorities, integrations, blockers, risks,
and decisions, but MUST NOT become parallel task backlogs.

A hierarchy change SHOULD be considered when repository and Fleet evidence
shows recurring coordination cost, for example:

- repeated work spanning the same group of domains;
- interface or sequencing decisions repeatedly waiting on one dispatcher;
- blockers or rework caused by dependencies discovered late;
- sustained cross-domain handoffs or escalation volume;
- a manager spending substantial effort switching among unrelated technical
  contexts; or
- a coherent integrated outcome that currently has no coordination owner.

Headcount alone is insufficient. The proposal MUST state the integrated
outcome the new or promoted role owns, why existing roles cannot handle it at
reasonable coordination cost, the evidence and observation window, authority
limits, affected identities and relationships, expected context or delivery
benefit, and the costs or risks of adding management. The change SHOULD begin
as a bounded pilot with review criteria and a way to reverse it.

The growth pathway MUST be an explicit, durable lifecycle:

```text
observe coordination evidence
        ↓
assess whether the cause is structural and recurring
        ↓
compare process changes, specialist changes, and coordination-role options
        ↓
submit an owner-facing organization proposal
        ↓
owner decision → migration plan → bounded pilot
        ↓
measure results → adopt, revise, or reverse
```

The Session Manager SHOULD run the read-only hierarchy assessment at startup
and when recurring coordination friction appears. Each project MUST configure
`organization_assessment.observation_window_days` (initial default: 30 days)
and `organization_assessment.minimum_recurrences` (initial default: 3).
TORCH MUST evaluate evidence inside that window and require either a sustained
pattern meeting the recurrence threshold or multiple independent signal types;
a single large task or temporary incident MUST NOT trigger a management
proposal. The assessment reports dated backlog tasks spanning the same domains,
coordination requests, named approvals awaiting the Session Manager, and
handoffs routed to it. The assessment is advisory and read-only: it never
creates a proposal or changes the active organization. Before proposing, the
Session Manager should also inspect qualitative context such as dependency
rework, late integration, and repeated context switching. Where measurements
are unavailable, the proposal MUST label the evidence as qualitative rather
than imply measured improvement.

Before proposing a lead, the Session Manager MUST consider whether a clearer
interface, direct peer agreement, backlog sequencing, a new implementation
specialist, or promotion of an existing specialist would address the cause
with less coordination cost. A hierarchy proposal MUST reach the owner through
the project's single owner-facing coordination role and include:

- the recurring problem and linked evidence, dates, and observation window;
- the integrated outcome and candidate role responsibilities;
- the domains or specialists it would coordinate and its explicit authority
  limits;
- alternatives considered, including no change and promotion of an existing
  identity;
- expected benefits, added context/meeting/routing cost, and pilot duration;
- success and stop criteria, baseline measures, and the reversal plan.

No repeated assessment should create or repeatedly resend the same proposal.
TORCH SHOULD deduplicate against open organization proposals and present only
material updates to the owner. An exact retry is idempotent; materially new
evidence with a later observation-window end MUST revise the existing open
proposal, preserve its earlier proposal revision, and invalidate any stale
owner-review preview. A material update without a later evidence window MUST
be rejected. Once an owner has approved, rejected, or deferred a proposal, a
later evidence window MAY create a new proposal for the same organization graph;
a terminal decision MUST NOT suppress future reconsideration. The owner may
approve, reject, or defer it; a recommendation alone never changes roles,
authority, routing, or sessions.

The Session Manager or a designated organization planner MAY propose a change,
but MUST NOT activate it unilaterally. The owner approves the intended
organization. Before activation, TORCH MUST produce a reviewable migration
plan that accounts for current backlog ownership and dependencies, identities,
branches and worktrees, prompts, communication links, schedules, checks,
management artifacts, start/stop order, and authority. Active work MUST remain
recoverable throughout the change. Approval, tracked configuration update,
session provisioning, and runtime launch are separate steps; runtime launch
remains an explicit action. Existing specialist-to-specialist communication
and backlog history MUST survive a hierarchy change.

For a pilot that changes only existing identity relationships, `hierarchy-plan`
MUST show the fresh graph delta, resulting manager-check-in schedule set,
obsolete schedule candidates, active work, and timer reconciliation requirement.
After owner approval, a separate `hierarchy-activate --by owner --yes` action
or an equivalent owner-confirmed local Console action may apply the approved
graph and newly required manager schedules to `.torch/torch.yaml`, update the
ownership manifest, record the pilot, and commit those tracked changes.
Activation MUST recheck the base commit, graph digest, clean worktree, owner
identity, active identities, and resulting config schema.
The Console action MUST preview the exact migration plan, require same-origin
loopback access, bind confirmation to a short-lived one-use plan digest, and
refuse stale state before committing; replaying the same confirmation MUST be
idempotent.
It MUST preserve existing cadence, leave obsolete schedules for explicit owner
review, preserve implementation ownership and active identities, and MUST NOT
create a session, provision a worktree, start a runtime, or change systemd
state. If an exact-config system timer is already installed, the plan MUST
report that it becomes stale; the owner separately reviews and runs schedule
launcher reconciliation after activation. Measuring the pilot, adopting it, or
reversing it remains a separately reviewed owner action.

Organization proposals MUST reference identities already present in the active
Fleet roster. A genuinely new persistent identity follows the separate
owner-approved Fleet-evolution and provisioning path; a hierarchy proposal
cannot smuggle in a new session or executable.

The pilot MUST start with the smallest affected group and retain a way to
continue under the prior organization. At the end of its review window, the
owner-facing role receives a comparison with the baseline using the proposal's
success criteria. TORCH may recommend adoption, adjustment, or reversal; only
the owner approves the next organizational change. A successful pilot is not
permission to add unrelated layers automatically.

Pilot comparisons are recorded through `torch fleet hierarchy-review-pilot
--proposal <id> --review <json-path> --from session-manager --yes` and read
through `torch fleet hierarchy-pilot-reviews --proposal <id>`. Reviews MUST
cover every baseline metric and success/stop criterion exactly once, preserve
the baseline units, and link evidence for each observation. Each metric is
explicitly measured, qualitative, or unavailable; values and criterion
assessments are reviewer-reported evidence, not independently verified facts.
Review records retain the activation commit and active graph digest, observed
values beside baseline values, review-window maturity and recommendation.
Before recommending adoption, the configured pilot duration must elapse, all
comparisons must be reported as measured, success criteria must be met and no
stop criterion may be met or unknown. Interim inconclusive/adjustment/reversal
reviews remain possible. Exact repeated evidence is idempotent and review
history is durable and audited. Recording a review does not adopt or reverse
the pilot, change the graph or tracked files, or start a runtime.

The read-only Console projects the latest bounded pilot-review history on each
hierarchy proposal, displaying baseline and observed values side by side,
units, evidence classifications, interim/full-window status, criterion
assessments and references. Reviewer-reported evidence MUST NOT be labelled
independently verified, and the view MUST distinguish a recommendation from an
owner conclusion. Reading the snapshot or opening review history MUST NOT
modify reviews, organizational state, or runtimes.

Owner conclusions use `hierarchy-conclusion-plan --proposal <id> --decision
<adopt|reverse> --reason <text>` followed by `hierarchy-conclude` with the same
arguments, `--plan-hash <digest> --by owner --yes`. The plan MUST bind the
current commit, active graph, owned pilot record, manifest, latest review,
active work and resulting relationships. A dirty repository, changed graph,
stale plan hash or missing owned record blocks the change. Adoption requires
the latest review to support adoption and leaves the active graph unchanged.
Reversal restores prior relationships from the proposal's base commit as a
new monotonic graph revision; implementation ownership must still match and
all referenced identities must exist. It preserves unrelated config, all
identities, worktrees, backlog history and communication records. Existing
schedules are retained, with obsolete candidates and any required timer
reconciliation reported for separate owner review.

The conclusion updates the owned tracked pilot/config/manifest files in a
scoped commit and records the owner decision in a local audit transaction.
Failed tracked commits restore the files and index. If the tracked commit
succeeds but the local transaction is interrupted, the same owner confirmation
may reconcile the committed, manifest-verified receipt against the current
graph; it MUST NOT repeat the commit. Confirmed retries are idempotent. Neither
adoption nor reversal launches/stops a runtime or modifies systemd state.

The local Console exposes the same separate owner conclusions for piloting
proposals. Preview MUST show the exact conclusion plan, affected work,
resulting graph, preserved schedules and blockers. Blocked plans receive no
confirmation token. Same-origin loopback access, short-lived one-use previews,
target/operation/action/reason binding and fresh plan revalidation are required.
Confirmation uses the underlying owner-authorized service plan hash; replaying
the same confirmed request is idempotent, while altered payloads or a token
from a different operation MUST be rejected. Adoption MUST recheck calendar
maturity at conclusion time, not merely trust a stored full-window flag.

On wind-down, coordination roles SHOULD record concise domain or program
state, while Fleet Operations preserves session and restart state. This
reporting supplements the backlog and does not replace it.

### 12.5 Temporary subagents

A domain manager MAY use runtime-native subagents for bounded research,
inspection, testing, or review. Temporary subagents do not receive persistent
Fleet ownership unless promoted through an approved roster change.

## 12.6 COMBATRIG example, not a default organization

COMBATRIG's proposed shape is a useful example for TORCH's organization
designer: a Program Director, Fleet Operations, a small number of domain leads,
specialists, and independent Art Direction. Runtime, World, Production, and
Narrative/Experience are candidate groups for that project, not built-in TORCH
domains. A project may promote an existing producer or specialist into a lead
role instead of creating another session. Horizontal QA, performance, release,
or creative review may connect to several domains without acquiring their
implementation ownership.

The example should be adopted incrementally:

1. Add a Program Director if owner-level prioritization and roadmap sequencing
   overload Fleet Operations; keep the existing Session Manager focused on
   session, worktree, gate, and fleet-health mechanics.
2. Pilot a Runtime Lead around the highest-cost repeated dependencies, such as
   simulation, navigation, AI, vehicles, and infantry.
3. Add a World Lead when terrain, settlement, interiors, navigation, and
   destruction repeatedly need coordinated sequencing.
4. Expand the existing Asset Producer into Production Lead if it can own the
   broader production outcome. Consider a separate Experience Lead only if
   Story and Campaign cannot absorb that coordination responsibility.

Keep Art Direction independent as a creative authority. Keep QA,
performance, browser, release, and infrastructure as horizontal services where
their work spans domains. Fleet Operations controls actual session start and
stop order based on approved dependencies. During wind-down, specialists
report meaningful changes to domain coordination, domain leads summarize
cross-specialist state to program direction, the Program Director records
milestone and cross-domain status, and Fleet Operations captures the sessions
and verifies the shutdown state.

This sequence is an example for COMBATRIG, not a TORCH default. Evaluate
reduced routing delay, integration rework, blocked time, and management context
cost against added coordination effort before expanding the hierarchy.

## 13. Control plane and MCP contract

The control plane MUST provide provider-independent operations for:

- identity;
- roster and domain discovery;
- ownership by path or capability;
- presence and session status;
- durable messages and acknowledgements;
- coordination requests and handoffs;
- status, completion, and blocker reports;
- durable approval requests, scoped visibility, and named-approver decisions;
- backlog references;
- resource leases;
- check and integration state queries.

The MCP surface SHOULD include:

```text
torch_identity
torch_list_agents
torch_get_agent
torch_get_roster
torch_who_owns
torch_neighbours
torch_send_message
torch_read_messages
torch_ack_message
torch_report_status
torch_report_complete
torch_report_blocked
torch_request_approval
torch_list_approvals
torch_decide_approval
torch_request_coordination
torch_request_handoff
```

Equivalent CLI operations MUST be available. Agent prompts SHOULD instruct a
session to query live ownership before touching a boundary rather than relying
only on context injected at session creation.

### 13.1 Message semantics

Every durable message MUST have:

- message ID;
- project ID;
- sender Fleet identity;
- recipient Fleet identity or declared group;
- creation time;
- body;
- acknowledgement state;
- optional task, path, commit, or handoff references.

Delivery to a runtime and acknowledgement by a Fleet identity are distinct
events. Runtime adapters MUST use native live messaging when reliable and MAY
fall back to durable inbox polling. A runtime outage MUST not destroy queued
messages.

### 13.2 Authority semantics

Peers coordinate directly. The Session Manager establishes priority and
ownership. No message may silently expand the recipient's permissions,
override owner policy, authorize spending, authorize deployment, or transfer
ownership unless it is represented by an allowed durable operation.

## 14. Runtime adapter contract

### 14.0 Provider distribution freshness

Owners MAY approve automatic built-in provider updates at installation with
`--update-runtimes`, or later through `torch runtimes update-policy --mode auto
--yes`. Without that policy, installation/startup MUST NOT silently acquire
new code. Approved normal `torch up --yes`, including resume, MUST refresh the
selected providers against their official npm latest stable releases when the
last successful check is older than the configured 1–168-hour window (24 hours
by default). Preview MUST be offline. Codex, Claude Code and Pi MUST be covered;
custom adapters require a separately reviewed distribution strategy.

TORCH MUST use versioned machine-local prefixes and exact selected executable
paths, not assume the first PATH entry is current. Downloads MUST preserve
global installs, login state, running processes and user provider settings.
The updater MUST serialize writes, validate registry versions, verify the
installed version and parser startup, and atomically publish each provider's
activation record only after success. Failed or interrupted updates MUST NOT
silently fall back while claiming freshness; prior activations and failed
installation evidence remain available. This does not establish model access,
live adapter compatibility, update-script safety or off-machine recoverability.
Package lifecycle execution MUST be visible in the approval preview. Persistent
schedule/hierarchy launch paths and platform-specific installers require their
own qualification; initial automatic integration is the normal `up` path.

### 14.0a Traceable production pipelines (planned)

TORCH MUST support optional project-specific multi-stage production flows,
without hard-coding game-art stages or requiring a pipeline in simple projects.
Session Architect and managers SHOULD identify recurring handoff failures,
repeated stage sequences, approval waits and integrated deliverables as evidence
that a pipeline may help. They MUST propose, not silently activate, a definition.
Prefer a simple checklist where no durable multi-stage state is justified.

A pipeline is a versioned contract for producing a deliverable; it is neither
a second backlog nor a mandatory new manager. Each definition MUST describe:

- a concrete outcome and one accountable flow coordinator;
- a bounded stage DAG with explicit parallel stages and join prerequisites;
- existing specialist implementation owners for each stage;
- required input types, immutable versions/hashes, and output contracts;
- project invariants, applicable checks, test conditions and scarce resources;
- machine acceptance criteria separately from creative/owner approvals;
- retry safety, failure escalation, rework routes and stall thresholds;
- permitted model/tool profiles and separate spending/asset-generation approval;
- external dependencies and honest reproducibility limitations.

Project constraints such as zero stock primitives, a locked model sheet or an
exact UV template MUST be explicit stage invariants. They MUST NOT become
generic defaults or be relaxed because a downstream tool finds them inconvenient.
Human taste approval MUST NOT be replaced by an automated geometry gate.

Each deliverable MUST have one persistent pipeline-instance record (for example
one rig, character, voice pack, migration, research packet or release). The record
MUST pin the definition revision and identify its current accepted outputs,
stage attempts, responsible identities, existing backlog task IDs, dependencies,
receipts, approval revisions, provenance and unresolved waits. Stage work MUST
use the existing authoritative backlog. A pipeline card is a view of that work
and its deliverable lineage, not another independently assignable task system.

A stage becomes eligible only when all predecessor outputs match their pinned
contracts and required checks/approvals are valid. Running, output-produced,
machine-verified, awaiting-approval, accepted, failed and invalidated MUST remain
distinguishable. Task completion or a file's existence MUST NOT imply acceptance.
Advancement MUST use revision checks so duplicate handoffs, parallel attempts
and concurrent managers cannot advance the same instance twice.

Changed upstream content MUST invalidate dependent evidence and approvals, not
silently reuse them. A definition edit MUST NOT rewrite a running instance's
history. Explicit owner-reviewed migration or a new versioned instance is
required. Rework MUST retain the rejected outputs, reasons and attempt lineage;
rollback MUST preserve history and respect irreversible external effects.

Provenance MUST include exact code commits where relevant, artifact content
digests, reference/UV-map/model-sheet versions, tool/model versions, non-secret
generation parameters and check conditions. Prompts and resource-sensitive
metadata MUST remain private with redaction and deliberate export. Seeds alone
MUST NOT be represented as guaranteeing reproducibility of hosted image/voice
models. Generated outputs are immutable recorded evidence; regeneration is a
new attempt, even with identical inputs. No generative provider or chargeable
service is invoked merely because a definition names it.

Debugging MUST answer: what is waiting, why, on whom, since when, which input or
gate failed, what changed between attempts, and what exact evidence permitted
the last transition. Evidence SHOULD support before/after visual review where
useful. Checks MAY be reused through explicit input/output capability contracts;
TORCH MUST NOT claim a mesh/UV/transcription checker exists just because it is
named in a template. Each project supplies and qualifies domain-specific checks.

Managers MUST surface stalled instances and handoff waits even when individual
tasks have recent commits. Waiting on owner, specialist, check resource, external
service and upstream rework MUST be separate reasons, not one generic stale
clock. Manager direct-report check-ins SHOULD consult these exception views.
They MUST NOT approve their own outputs, create approval pressure loops, or
invent tasks to keep a pipeline busy.

The Console SHOULD show deliverable cards, stage timeline/DAG, accepted versions,
current owner, age/reason of waits, failed checks, approval actions and evidence.
Owners MUST be able to comment on an exact output version, approve within their
authority and request rework. The hierarchy coordinates outcomes; specialists
retain ownership and direct communication. Existing Art/Production leads MAY
coordinate a flow; a new lead requires the existing evidence/owner approval path.

Initial implementation order (not implemented by this specification update):

Console design requirements:

- Show a Pipelines navigation entry only when approved definitions/instances
  exist. Otherwise show a contextual proposal entry in setup, not an empty
  production board or an automatically created generic pipeline.
- Group instances by pipeline revision. Each row shows deliverable name,
  current stage(s), coordinator, stage owner, working/waiting duration, waiting
  reason/party, latest evidence and attention status. A pipeline-stage strip
  communicates actual accepted, active, waiting and invalidated stages. Parallel
  active stages MUST NOT be flattened into a falsely linear progress percentage.
- Filter by pipeline, deliverable, coordinator, stage owner, wait reason and
  attention state. Save views through the existing project-scoped view mechanism.
  A linked backlog task can open its deliverable view; ordinary tasks remain on
  the Work board. Show a reciprocal link instead of copying task state.
- Opening a deliverable shows its actual DAG/timeline, inputs and output
  previews, acceptance metrics, approval subject/revision, rejection reason,
  attempt history and upstream/downstream lineage. A "Why is this waiting?"
  summary identifies the exact unmet prerequisite and permitted next action.
- Owner actions use the existing preview/confirmation and authority boundaries:
  comment on an exact artifact, review an approval, request rework, pause or
  resume a permitted instance, or review a proposed definition migration.
  No drag gesture may bypass a stage gate; raw state editing is not an owner
  convenience feature. A definition/role proposal is never a creation approval.
- Retain the existing dark TORCH visual identity, keyboard accessibility,
  mobile layout, draft/focus preservation and protected refresh. Text/icons
  must distinguish stage states without relying on color. On mobile show the
  current stage and blocker first, then expand the full flow. Failed snapshot
  loads preserve the last evidence with an explicit stale timestamp.
- Aggregate per-stage active versus waiting time, rework count, categorized
  check/approval failures, measured usage/cost and evidence coverage. Unknown
  cost remains unknown; wall-clock time is not active processing time. Compare
  metrics only for compatible definition versions and explain denominators.
- After a configurable sample (five completed instances is a starting point,
  not a universal rule), a manager MAY propose one bottleneck improvement with
  baseline, expected metric change and review window. Changes require the same
  definition-review boundary; existing instances stay pinned. Avoid claiming
  causal improvements from small or incompatible samples.
- The shared Console demo MUST use the same renderer with clearly labelled
  fixture evidence. It MUST NOT call live provider APIs or represent fixture
  approvals and metrics as real project measurements.

Example only (project-defined stages, not a built-in rig template):

```text
Pipelines / Rig production
Deliverable   Stage                 Waiting on       Since      Owner
Bastion       Model sheet review    Art approval     2 days     Concept Art
Wayfarer      Texture check         UV coverage      18 min     Textures

Bastion / definition v2 / attempt 3
Spec -> Concept -> Model sheet -> Mesh -> Texture -> Integration
                    awaiting approval
Inputs: approved concept digest / locked proportions digest
Output: model-sheet digest + preview
Required: proportion check passed; Art Director approval pending
[Review evidence] [Comment] [Request rework]
History: attempt 2 rejected, silhouette too wide; retained for comparison
```

This view is planned, not a currently available Console feature.

1. Definition/instance schemas, validation, read-only pipeline assessment and
   owner-reviewed activation; reject cycles, unknown owners/checks and overlaps.
2. Backlog-linked durable transitions, pinned artifacts, checks/approvals and
   output-specific feedback, with rework and idempotent crash recovery.
3. Why-waiting and stall diagnostics plus manager exception reporting.
4. Console deliverable cards and attempt/lineage comparison.
5. TORCH self-host pilot on a docs/software pipeline; COMBATRIG art integration
   remains a separate project-authorized adoption.

Required acceptance scenarios MUST prove that a stale UV/reference input blocks
downstream advancement; changed output invalidates approval; duplicate handoffs
advance once; a parallel join waits for every accepted branch; rejection preserves
history; restart resumes the same stage attempt; resource waits are not mistaken
for productive work; and an owner decision cannot be replaced by an AI manager.
No pipeline runtime or COMBATRIG mutation is authorized by documenting this plan.

Each adapter SHOULD implement capabilities equivalent to:

```text
detect
configure
createSession
resumeSession
sendOrSteer
getStatus
listSessions
stopSession
captureRuntimeId
installHooks
removeHooks
```

Adapters MUST declare supported capabilities. TORCH MUST not pretend an
unsupported capability exists. Where a runtime lacks live steering or peer
messaging, the adapter may use the durable control plane and trigger a later
turn or polling cycle.

Claude is the first reference adapter because COMBATRIG proves its operating
model. Codex is the second required adapter and is the portability proof.
OpenCode, Pi, and other runtimes follow the same contract. TORCH policy and
durable inter-session communication remain provider-independent; runtime-native
messaging is optional and cannot replace the TORCH control plane.

Every adapter MUST declare `perInvocationCostCeiling` as separate supported
mode identifiers for `createSession` and `resumeSession`. When a schedule
requires a maximum USD spend, TORCH passes that amount into the selected exact
operation and accepts a launch plan only if the adapter returns an enforced
receipt containing the same amount and declared mode. Missing, mismatched, or
unsupported declarations/receipts block before invocation and before daily
budget reservation. Telemetry or an estimated price is not enforcement.
Adapters must not claim support unless the selected runtime mode itself can
enforce the limit. The built-in Claude, Codex, and Pi adapters currently
declare no supported hard-cap modes. They MAY run owner-enabled count-limited
manager wakes; USD-hard-cap mode remains unavailable until a verified
enforcement implementation exists. Count-limited mode must never claim a
dollar spending ceiling.

A single Fleet MAY mix runtimes and models by domain. Git provider choice and
AI runtime choice are independent.

### 14.1 Per-session runtime and model profiles

Generated proposals MUST use `runtime: "default"` for roles without an explicit
provider assignment. Installation resolves those roles to its selected default
adapter. `--runtime codex` MUST permit a Codex-only installation; selecting
multiple adapters MUST preserve explicit per-identity assignments. The
`--default-runtime` option selects the inherited adapter independently of the
available adapter list. Without that option, an explicit Session Manager
assignment takes precedence, followed by the first selected adapter. With no
selection or explicit assignment, the existing CLI compatibility default is
Claude. The dry-run MUST show the resolved default. Pending Session Architect
designs may name Pi or a custom adapter; installation MUST still validate
availability and plugin trust before writing project state.

Every persistent identity, including the Session Manager and optional
coordination roles, MUST be assignable its own owner-approved runtime profile.
A profile selects a locally available runtime adapter, model identifier,
reasoning/effort setting when supported, and launch policy. Different sessions
in one Fleet MAY use different providers and models at the same time—for
example, Claude, Codex, Pi, or separate model tiers such as `luna` and `astra`.
These labels are configuration values, not hard-coded TORCH model assumptions.

For a new installation, the built-in defaults SHOULD be Codex
`gpt-6-luna` at high reasoning effort and Claude `sonnet`. Users MUST be able
to change runtime defaults and per-identity overrides in the installed project
configuration without modifying TORCH source or global provider settings.
Changing a profile MUST NOT start or stop a session.

Launch policy MUST be a nested `launchPolicy` object on a runtime default
(`runtimes.<adapter>`) and optionally an identity. Identity fields override
matching defaults; omitted fields inherit. Each adapter MUST declare exact
supported field/value sets. Nonempty policy on a custom adapter without that
declaration, unknown values, unsupported fields, unsafe settings, or
incompatible combinations MUST block doctor and planning before runtime
execution. `torch profile show` MUST expose effective policy; profile set and
defaults MUST accept repeated `--launch-policy field=value` and
`--reset-launch-policy`, require `--yes`, and affect future plans only.
The local Console MUST offer the same per-identity profile choices through a
same-origin owner preview and separate confirmation. It MUST show the exact
current and next-launch profiles, revalidate configuration freshness before
writing, and audit the owner action. It MUST NOT start, stop, or reconfigure a
running session. Runtime adapters shown as choices MUST be built-in or
explicitly user-trusted; an unavailable or changed plugin MUST be visibly
unavailable rather than silently substituted.

Codex supports `sandbox=read-only|workspace-write|danger-full-access` and
`approval=on-request|never|approve-for-me`. `approve-for-me` maps to
`--approve-for-me` and cannot combine with explicit `sandbox`; other approval
values map to `--ask-for-approval`, and sandbox maps to `--sandbox`. The fresh
default remains `approve-for-me` (implicitly workspace-write), preserving the
current invocation. Historical generated flat `sandbox=workspace-write` plus
`approval=approve-for-me` is recognized as that effective policy and migrated
to nested form on an owner policy edit; incompatible legacy values fail closed.
Claude supports only `permissionMode=default|acceptEdits|auto|manual|dontAsk|plan`;
`bypassPermissions` and danger-skip flags are prohibited. Pi accepts no
overrides and MUST keep TORCH's fixed `--no-approve`, `--no-extensions`, and
`--no-context-files` flags.

An installed Fleet MUST detect unavailable adapters before startup and explain
which identities cannot launch. It MUST NOT silently substitute a provider or
model. Adapters declare unsupported settings and lifecycle capabilities; TORCH
uses durable messages, acknowledgements, and resume state when native steering
is unavailable. A runtime-profile change is tracked and owner-reviewed,
preserves Fleet identity and backlog, and does not itself launch a process.
Runtime starts remain explicit actions with configured authorization and
budget boundaries.

TORCH MUST NOT restrict adapters to a hard-coded vendor list. An explicitly
installed local plugin may participate when it satisfies the adapter contract
and can receive TORCH's scoped identity-bound MCP or equivalent control-plane
endpoint. Plugin installation and executable allowlisting are explicit local
configuration choices; model proposals cannot add arbitrary executable paths
or launch commands.

The first local plugin flow uses a user-owned trust store outside the project:
`$XDG_CONFIG_HOME/torch/runtime-adapters.json` (or `~/.config/torch/` when
`XDG_CONFIG_HOME` is unset). The initial adapter entrypoint contract is a
canonical absolute `.cjs` file exporting
`createTorchRuntimeAdapter({ env })`. `torch runtimes trust` first displays the
entrypoint path and SHA-256 without executing it; approval must echo that exact
hash with `--yes --sha256`. A changed entrypoint invalidates the reviewed hash
and fails closed. Project-tracked configuration may select an adapter already
trusted by the user, but cannot add, change, or authorize a module. `torch
runtimes list`, doctor, and profile inspection must not load plugin code.
Loading a trusted plugin executes it and its imported dependencies with the
current user's operating-system privileges; the entrypoint hash does not pin
those dependencies. Install/start/profile-change operations may load the
selected adapter to validate or plan it, including a dry-run that uses it.
Revocation affects future registry loads and does not stop an already-running
process. The user must stop a session separately before revoking its adapter.

## 15. Session lifecycle

### 15.1 Fresh start

`torch up --fresh` creates new runtime conversations while preserving Fleet
identities. It combines the common prompt, domain prompt, current approved
configuration, and initial resume instructions. The generated instruction
bundle MUST include the current identity's organization roles,
responsibilities, authority, reporting line, direct reports, coordination links,
and implementation ownership from the active organization graph. This
structured context is metadata, not an authority grant; it is included in the
instruction digest so changes reach the identity on its next start or resume.
Runtime IDs are captured as soon as they are available.

Runtime identities start in parent-before-report order derived from the active
organization graph, so managers are available before their direct reports.
Wind-down reverses that order and routes each active identity's final status to
its direct manager identities. If multiple roles mapped to one persistent
identity create an identity-level cycle, TORCH blocks the plan rather than
guessing. Planning remains read-only; actual runtime startup still requires the
explicit owner-approved launch operation.

### 15.2 Resume

Normal `torch up` resumes known runtime sessions when safe. If a conversation
cannot be resumed, TORCH creates a replacement runtime session for the same
Fleet identity and supplies durable state. The current organization metadata is
recomputed from canonical project configuration on each resume; stale generated
or worktree prompt copies MUST NOT override it. Loss of a conversation MUST NOT
erase ownership or unfinished work.

### 15.3 Presence

Presence distinguishes at least:

```text
starting
working
waiting
idle
stale
stopping
offline
```

Presence is advisory. A stale heartbeat does not free a worktree or transfer
ownership.

### 15.4 Wind-down

Before shutdown, every domain MUST:

- stop or safely leave active checks;
- release or transfer resource leases;
- record dirty, committed, pushed, and integration state;
- update its backlog and unfinished-work record;
- push work required by the configured recoverability boundary;
- send one final status to the Session Manager.

The Session Manager writes or validates `RESUME-BRIEF.md`, captures session
mapping, records fleet-wide risks, and stops last.

Implementation checkpoint (2026-09-27): planned wind-down fails closed on
working, starting, or stopping identities; active Git operations; unreleased
resource leases; active check or measurement guards; and integration already
landing. Every non-offline worker sends a durable final status to the Session
Manager before runtime stop. TORCH preserves unfinished task identity, captures
runtime mappings plus worktrees, integration, guards, and leases locally, and
atomically writes `.torch/RESUME-BRIEF.md` in the Session Manager worktree
before the manager is considered stopped. This is scenario-tested with
virtualized runtime shutdown; live provider shutdown remains an operational
qualification gate.

## 16. Git and worktree policy

### 16.1 Isolation

The main checkout remains on the canonical branch and SHOULD not be used for
domain implementation. A domain session works only in its assigned worktree.

TORCH MUST inspect process ownership and working directory before stopping a
process. Parentage alone does not establish ownership.

Implementation checkpoint (2026-09-27): the Claude stop adapter resolves the
durable runtime-session ID through the provider's live session inventory and
requires its reported working directory to equal the managed identity's
worktree before issuing a stop. Missing ownership evidence or a mismatched
directory fails closed. A provider-reported offline session is treated as
already stopped. Codex declares stop unsupported and is never silently killed
through an operating-system process heuristic.

### 16.2 Safe convergence

TORCH MUST distinguish scheduled observation from scheduled mutation:

> Monitor automatically; mutate worktrees intentionally.

No timer may blindly pull, merge, rebase, or reset domain worktrees. Doctor may
observe drift and the Session Manager may request convergence at a safe point.
The owning domain performs the mutation.

The normal sequence is:

```text
implement
→ verify locally
→ commit
→ fetch canonical Git store
→ merge canonical main
→ resolve conflicts
→ rerun required checks on the combined tree
→ push domain branch
→ request integration
```

Persistent branches MUST NOT be automatically rebased. Bare `git stash` SHOULD
be prohibited where worktrees share one stash stack.

### 16.3 Measurement protection

TORCH MUST defer convergence when a worktree is:

- running a check or measurement;
- deliberately pinned;
- dirty at an unsafe checkpoint;
- resolving a merge or other Git operation;
- holding state whose inputs would change under merge.

A worktree legitimately measuring an older commit is not stale merely because
main advanced.

## 17. Backlog, decisions, and durable memory

The tracked backlog is the durable work queue. It MUST support at least:

```text
proposed
ready
assigned
in_progress
blocked
verification
ready_to_integrate
completed
cancelled
```

Items SHOULD identify owner, dependencies, affected domains, acceptance
criteria, evidence, the commit where the issue was observed, and current commit
when applicable. A task MAY also carry free-text `feature` and `milestone`
labels, each bounded to 120 characters. These labels group existing work for
program visibility; they do not create a second ticket, initiative registry, or
queue.

The Session Manager MAY set those labels when creating work or classify an
existing item using its current revision, with a reason recorded in task-local
classification history and the project audit stream. Classification MUST NOT
change task state, assignment, evidence, or dependencies. Specialists cannot
change initiative labels. Labels may be explicitly cleared.

The queue is singular across Program Director, domain lead, Session Manager,
and specialist views. Management layers sequence and route this queue; they do
not create parallel backlogs. For a specialist, next-work resolution MUST:

1. return that specialist's existing active assignment before any ready item;
2. otherwise return the first eligible ready item in deterministic queue order;
3. otherwise report the area idle without inventing work.

Assignment MUST fail closed when the specialist already owns another active
item. This invariant is serialized across different task files, not merely
protected by per-task revision locks. Blocked work is durable but not runnable;
it may be reconsidered explicitly when its dependency evidence changes.

### Policy-controlled specialist self-claim

Manager assignment remains the default. An owner-reviewed project configuration
MAY enable `backlog.self_claim: { enabled: true, areas: [...] }` for explicit
specialist identities. Omitted policy and new installations are disabled.
Coordination/manager roles do not gain implementation ownership through this
policy. Current canonical configuration, not a conversation or cached service
copy, determines eligibility on each request.

`backlog claim-next --dry-run` / `torch_plan_backlog_claim` previews eligibility.
`backlog claim-next --yes` / `torch_claim_next_backlog_task` resolves existing
active work first without mutation, then atomically selects and assigns one
eligible ready item. Selection honors priority (urgent, high, normal, low), then
creation time and task ID. It MUST NOT select proposed, blocked, dependency-gated,
unrouted work or work reserved for another owner. Self-claim requires the caller
to be explicitly listed in both project policy and the task's affected domains.
General unrouted requests remain manager-routed work; no filler is invented.

Before a new assignment, verify the managed specialist worktree is present,
clean and on its mapped branch, with no active Git operation, check/measurement/
pin guard, prepared/running check, unreleased resource, waiting resource request,
unfinished integration request or pending named approval for that identity.
Blocked plans return concrete reasons and do not change work or release waits.
An existing assignment remains resumable even if permission to claim new work
has since been revoked; this is observation, not a new grant of authority.

Manager assignment, self-claim and all transitions into active assignment
states share the same project-wide assignment lock and task revision checks.
A blocked item MUST NOT reactivate as a second active task while its owner has
other active work. Lock contention fails closed; it never steals a stale lock.
Claim history and audit identify the actual specialist, not a fabricated
manager identity. Self-claim does not send acknowledgement-only assignment
messages to itself or authorize completion, release, deployment or ownership
changes. The existing evidence and landed-commit completion rules remain.

After an item is finished and its work/tests/integration are settled, specialists
re-read current instructions and resolve their next item. Routine progress is
recorded in commits, tasks and durable status. Escalate decisions outside scope,
cross-domain conflicts, owner-sensitive approvals, main regressions and at-risk
work. Direct specialist communication remains available.

Backlog health is read-only and reports exceptional conditions, including
multiple active assignments, stale assigned work, resolved dependencies on a
blocked item, missing or retired areas, old observation commits, ready work
without a live eligible specialist, and active work whose runtime session is
missing. Health never rewrites or reassigns work automatically.

### Commit-linked activity

Read-only activity observation scans canonical and managed local branch history
within approved `backlog.activity.stale_days` and `max_commits` limits (defaults
3 days and 1000 commits). Exact task IDs in commit messages link activity to
the single authoritative backlog. Metadata-only task edits MUST NOT refresh
the commit-activity clock. Owner-originated requests sort first; blocked work
is identified as expected waiting, not silently revived. Completed/cancelled
items are excluded from stale findings. Missing branches or truncated coverage
MUST yield unknown absence of activity, not a false assertion of neglect.
Future-dated commits do not count as current progress. These observations are
Git-reported metadata, not independent evidence of meaningful implementation.

Standalone `Closes: TASK-id[, TASK-id...]` trailers express completion intent,
never authority. Activity observation never mutates task state. Approved
`backlog.activity.auto_close_after_landing` enables post-landing reconciliation
of trailers from the exact submitted tip; default is disabled. Reconciliation
MUST require matching project/target landed integration evidence and canonical
ancestry, current approved required checks, specialist ownership, exact task
commit, task evidence and `ready_to_integrate` state. It uses the normal
revision-checked completion transition under a task lock. Unknown or mismatched
items stay open; exact already-completed items are unchanged on replay.

Fleet Operations can preview and explicitly reconcile a landed request through
CLI/MCP after interruption. Automatic reconciliation failures MUST NOT reverse
or misreport a successful Git landing; they surface `needs-review` and a
durable audit when available. Partial completion is retryable per task, not an
atomic transaction across all mentioned items. A commit message alone MUST NOT
close a task or authorize deployment. Daily reviews and dashboard surfacing
remain separate pending work; observation installs no timer.

Owner decisions affecting future work MUST be recorded durably. Chat messages
alone are insufficient. Project source, tests, approved configuration, and
accepted decision records outrank summaries and generated prompts.

Implementation checkpoint (2026-09-27): backlog items are revisioned JSON
records in the Session Manager's tracked worktree. The service and equivalent
CLI/MCP operations enforce transition, owner, dependency, one-active-item, and
concurrent-write rules; resolve assigned work before ready work; publish
assignments and blockers through durable messaging; surface active work and
health anomalies in doctor; and require a landed integration record at the
same commit before completion. Keeping management records in the manager
worktree prevents backlog activity from dirtying canonical main.

## 18. Checks and evidence

Projects declare checks as commands with optional resources and applicability.
TORCH executes them locally or through a configured provider and records a
receipt containing:

- check ID and definition version;
- exact Git commit;
- worktree and domain;
- command and relevant environment identity;
- start and finish time;
- exit status;
- coverage or subject description;
- artifact references;
- resource lease used;
- pass, fail, blocked, or incomplete result.

A passing receipt becomes stale when its tested commit changes or when policy
declares a relevant input changed. TORCH MUST never apply a receipt from one
commit to another merely because the branch name is unchanged.

Projects SHOULD retain scenario-level checks at meaningful system boundaries.
Fleet infrastructure itself MUST have acceptance tests that demonstrate both
success and failure behavior.

### Frozen inputs for queued checks

A project MAY declare `snapshot: { paths: [...], source_commit_file: "..." }`
on a check. Paths are explicit repository-relative inputs, including ignored
generated build files when appropriate. The project writes the full source
commit SHA to the marker as part of its build. The marker MUST match the clean
source worktree commit and MUST be included in the captured inputs. This is
project-declared provenance, not independent proof that its builder is correct.

`checks prepare` / `torch_prepare_check` captures inputs before the specialist
requests a scarce-resource slot. Copies use reflinks when supported or ordinary
independent copies; they MUST NOT hardlink mutable build files. Captured files
are hashed, input files are read-only, and source/copy changes during capture
fail closed. Symlinks, traversal, Git metadata, and nonregular inputs are
rejected. Frozen state lives outside the worktree in TORCH-owned local state.

After preparation, acquire the configured resources through the existing FIFO
resource service, then run `checks run-prepared` / `torch_run_prepared_check`.
The run MUST verify captured content, unchanged approved check policy, bound
identity and active resource leases. It executes from the captured input root;
later specialist commits do not invalidate that historical subject. A passing
receipt applies only to the captured SHA and policy, never a later worktree
tip. A changed snapshot, lost lease or failed executor yields nonpassing
evidence. Output-writing checks should put their outputs outside the declared
input paths. This mechanism is input isolation, not a process sandbox: approved
commands must use their captured working directory instead of absolute live
build paths or an unrelated existing server.

Preparation and run claim are durable. Completed/cancelled runs remove only
the exact owned input copy while retaining its manifest/digest and receipt.
An interrupted `running` record is not automatically rerun or cancelled:
unknown process state requires operational inspection. Resource acquisition
and release remain explicit operations; preparing/cancelling a check does not
steal, release or cancel an independently held resource. No background runner
or persistent timer is implied by preparing inputs.

Interrupted prepared checks MUST remain non-runnable until explicitly resolved;
age, a missing heartbeat or an observation timeout is not stopped-executor proof.
The runner identity is recorded before measurement. Linux PID start/boot identity
can distinguish reused PIDs; other process observations remain conservative.
Recorded live runners MUST block recovery. Missing, foreign-host or legacy runner
metadata is unknown, not independent evidence that executors stopped.

`torch checks recovery-plan --prepared <id>` is an owner-only read-only preview.
`torch checks recover-prepared --prepared <id> --executors-stopped --evidence
<text> --yes` requires explicit owner evidence covering the runner and all child
executors. It records terminal `abandoned` state plus an audit atomically, never
creates a receipt, never resumes execution and never releases resource leases.
Cleanup follows only for the exact owned snapshot; ownership mismatch leaves
cleanup pending and explicit repeat recovery can retry without duplicate audit.
The owner attestation is not an automatic descendant sensor. Future measurements
require newly prepared inputs and independent lease handling.
Cleanup outcomes MUST persist for observation. Interrupted outcome persistence
retains pending rather than claiming completion. The Console MUST retain abandoned
check visibility with completed/pending/unconfirmed cleanup labels; missing or
unreadable legacy metadata stays unconfirmed. Projection MUST omit private input
paths, owner evidence and process IDs, and MUST NOT probe files, recover checks,
or imply independently verified descendant termination. Replay updates cleanup
outcome without repeating the original owner-authority audit.

Frozen receipts MUST link to a finished prepared operation before exact-pass
qualification. Receipt persistence alone after a partial/crashed run is not enough.

### Project-defined test conditions

A check MAY declare a `conditions` policy with a shell-free probe command,
arguments, bounded `timeout_seconds` (default 30, maximum 300), and nonempty
unique `required` conditions of `{ id, equals }`. Expected values are literal
strings, booleans, finite numbers or null; no coercion is permitted. TORCH does
not hardcode game-specific switches, GPU, clock or visibility rules.

The probe MUST return one bounded JSON object with schema
`torch.dev/check-conditions/v1alpha1`, a `subject` naming its actual full commit,
and a `conditions` object. For frozen inputs, `subject.inputDigest` MUST match
the captured digest. TORCH provides `TORCH_CHECK_COMMIT` and
`TORCH_CHECK_INPUT_DIGEST` to both probes and measurement commands as expected subject metadata. A project
probe MUST observe the tested build/runtime, not simply echo expectations.

A report MAY include a `runtimeId` (nonblank string, at most 256 characters).
If preflight supplies one, postflight MUST supply the same identity; a missing or
changed identity invalidates even otherwise healthy conditions. Supplied malformed
identities invalidate preflight. Projects SHOULD use an identity generated by the
actual tested runtime, not a constant derived from its build. Legacy reports with
no identity in either probe remain supported but do not prove runtime continuity.

TORCH probes after resource acquisition and before measurement execution. A
failed, missing, oversized, malformed, mismatched-subject or mismatched-condition
report MUST prevent measurements from starting and produce an incomplete
receipt, not a product-test failure. It probes again after execution; an invalid
postflight MUST invalidate a green measurement. The harness is responsible for
observing the same page/runtime used for measurements and for detecting
condition changes during the measurement interval; endpoint probes cannot prove
that conditions remained stable at every instant.

The retained output places a `TORCH_CHECK_CONDITIONS` JSON diagnostic before
measurement output and a postflight line after it. Before/after reports, reasons,
policy and subject identity are retained in the receipt and artifact. Evidence
is explicitly `project-reported`, not independently verified sensor truth.
Exact-pass qualification requires valid before/after condition evidence and
matching policy, not merely exit zero. Legacy checks remain supported without
this optional policy; this is not a claim that they observe test conditions.

### Proposed nonnormative design: candidate-source qualification contexts

**Status: proposed design contribution only.** This subsection records an
interface direction for review under TASK-6e4ff870-a386-4a11-a59c-444ebc23732e.
It does not change a current check, receipt, schema rule, integration gate, or
authority. In particular, it does not change the current schema-version refusal
or reclassify any legitimate legacy receipt.

A future candidate-source qualification design would keep three independent
axes in every newly-versioned result:

1. **Engine provenance (E)** is the exact engine source commit, module path,
   dependency-resolution digest, source-tree digest, runtime/build bytes, and
   versioned interface contract. Matching engine bytes do not themselves grant
   receipt authority.
2. **Check subject scope (S)** identifies either an authenticated, clean,
   unlanded product-source commit or an installed operational runtime. It also
   carries immutable product-storage schema metadata (digest or explicit null),
   which is subject/input evidence rather than registered receipt/control-plane
   schema authority. Candidate-source evidence is not an operational acceptance
   and must not stand in for the post-landing operational subject.
3. **Receipt authority (A)** identifies the registered receipt adapter that
   independently validated and stored the result, including its exact adapter
   bytes, `registeredReceiptSchemaVersion`, and compatible registered
   receipt/control-plane schema versions. A fixture attestation is not a
   registered receipt.

The proposed `CandidateReceiptTuple/v1` would bind, at minimum, protocol
version; E's engine source commit, module path, dependency-resolution and tree
digests, runtime/build-byte digest, and interface version; S's subject kind,
authenticated project/install identity, exact product commit,
`subjectProductStorageSchemaDigest` (or explicit null), and frozen check
definition digest; and A's adapter identity, digest, interface version,
`registeredReceiptSchemaVersion`, declared compatible receipt schemas, and
observed registered control-plane schema version
(`observedControlPlaneSchemaVersion`). E is independently recorded and is not
presumed to equal S's product commit. It would also bind
input snapshot digest, guard/resource
binding, durable attempt identity, sealed artifact-manifest digest, and actual
terminal outcome. Product-storage metadata must never be interpreted as a
control-plane migration request.

The registered-root authenticator, rather than a caller, would derive the
registered area, project/install identity, clean managed subject, exact product
commit, and root binding. The initial proposed CLI therefore accepts no caller
commit, root, manifest, state-root, database, schema, context, adapter selector,
or expected-commit value. If a future reviewed expected-commit option is ever
accepted, it can only reject a mismatch against the already-derived subject; it
cannot select a subject or confer root, adapter, or receipt authority.

For a future native candidate result, a Kernel-authenticated context would be
derived from the registered manifest/root and a clean managed candidate at the
exact commit. The candidate engine would never initialize `ControlPlane` and
would never receive the registered manifest, state-root, database handle, or
receipt-writer capability. The only proposed real-receipt writer is a
versioned registered adapter which first validates the complete tuple and its
schema compatibility, then performs receipt DML only; it must perform no DDL,
migration, schema relabel, or root redirection. A future product-schema-3
subject may be qualified hermetically by genuinely pure, schema-agnostic engine
bytes and an authenticated schema-2-compatible adapter only when the reviewed
tuple explicitly supports that combination. That possibility does not alter the
current candidate CLI/engine, which initializes `ControlPlane`, requires schema
3, and must continue to refuse against registered schema 2. Existing exact
source receipts valid under a schema-2-compatible legacy adapter remain
evaluated under their recorded legacy contract; they are neither globally
invalidated nor silently upgraded to this proposed tuple.

A future fixture context would use an independently authenticated, unique
fixture project identity, manifest digest, state root, and XDG data root. Its
output is a `SourceAttestation/v1`, permanently nonpromotable to a registered
receipt: it cannot be copied, relabeled, stored in the registered receipt
database, or consumed by Integration, Backlog, or Delivery as a gate result.

The proposed candidate runner would receive an opaque, parent-created, fresh
single-use attempt and artifact transport, not a caller-provided receipt
handle. Its declared inputs are a verified immutable source/input snapshot, a
frozen definition, the bounded command arguments, and an explicit environment
allowlist. The proposed baseline gives it per-attempt `HOME`, `TMPDIR`,
`XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME`, a
dedicated artifact directory, and no inherited registered-state locations or
provider credential variables. The adapter-owned collector accepts only
regular artifacts beneath that attempt directory, refuses path traversal and
links, and hashes a sealed manifest.

The proposed lifecycle is: durable guarded attempt creation; one worker
transport; execution; adapter-observed proven terminal outcome; manifest
sealing; then one atomic persistence action that consumes the attempt and
persists terminal evidence after full tuple revalidation. A fully revalidated
`PASS` inserts its registered receipt in that same atomic action; non-PASS
evidence cannot satisfy a passing receipt or gate. `PASS`, `FAIL`, and proven
`INCOMPLETE` are distinct terminal outcomes. `FAIL` and `INCOMPLETE` remain
observable durable evidence. Error, signal, timeout, ENOBUFS,
malformed transport, input/subject drift, and zero-exit mutation are
`INCOMPLETE` when proven; interruption, cancellation, or an ambiguous commit
without a proven terminal outcome is `UNKNOWN`. `UNKNOWN` creates no receipt,
does not consume-and-lose the attempt, and retains evidence plus existing
resource/worktree guards for reviewed recovery. Neither cancellation nor any
unknown or failed state permits automatic replay or release; consumed or
replayed attempt identifiers fail closed.

Withholding those handles and capabilities is an **authority boundary**, not
an operating-system filesystem sandbox. It prevents an authorized interface
from conferring registered-root or receipt-writing authority; it does not by
itself prevent same-user candidate code from discovering ambient host files.
The exact durable store, guard/fence ownership, process-isolation mechanism,
environment allowlist exceptions, artifact sealing/transport primitive,
cancellation and recovery semantics, credential handling, and replay detection
remain enforcement decisions for a future reviewed implementation.

## 19. Shared-resource coordination


Resources such as browsers, GPUs, ports, databases, devices, API quotas, and
deployment accounts are declared with capacity and policy.

TORCH MUST support:

- FIFO queuing;
- lease ownership;
- acquisition and release;
- stale-owner detection;
- maximum hold policy;
- cancellation without leaking the resource;
- doctor visibility;
- project-specific bypass policy requiring explicit authority.

Fairness matters more than raw agent count. The Fleet SHOULD be sized around
the scarce machine and the cost of meaningful verification.

## 20. Integration queue and main protection

Pull requests are optional. TORCH provides a native integration queue with
records containing:

- source domain, branch, and commit;
- target branch;
- convergence state;
- required and observed check receipts;
- affected ownership boundaries;
- dependencies;
- authorization;
- current state and reason.

Example states include:

```text
needs_convergence
testing
blocked
ready
landing
landed
superseded
```

Before landing, TORCH MUST verify:

1. the source commit still exists and is recoverable;
2. the branch includes the required canonical state;
3. required checks passed for the exact source commit;
4. no required check was invalidated;
5. ownership and dependency conditions are satisfied;
6. the actor has landing authority;
7. the target has not advanced beyond policy tolerance.

Fleet policy MUST be enforceable without provider branch protection. A forge
adapter MAY mirror the same policy as defense in depth.

The canonical branch is single-writer. Specialist identities MUST NOT push
their branches directly to the canonical branch or its remote; all landings go
through TORCH's integration authority. The final target re-check and
fast-forward MUST be serialized across TORCH processes with a project-scoped
lock/transaction. Authorized requests MUST be drainable in durable insertion
order by one landing-authority invocation; direct specialist pushes remain
prohibited. The FIFO drain MUST re-evaluate each request against the latest
target after every landing. A candidate that omits a newly landed canonical
commit MUST move to `needs_convergence` and remain unlanded until its owner
converges and reruns exact-commit checks. The drain may continue to other
independently ready requests; it MUST NOT weaken checks or reassign the stale
candidate. A direct `integrate land` request MUST also respect the same FIFO
position and cannot skip an earlier ready request. `torch integrate drain` is
an explicit main-mutating operation and requires confirmation. This one-shot
processor is not itself a daemon or timer. A project MAY define a typed
`integration-drain` system schedule, but it MUST be periodic, owner-authorized,
use a configured landing-authority identity, and run no more often than once
per minute. It processes only requests already authorized by that identity and
whose exact required checks still pass. The schedule is mutating: it does
nothing until the owner separately installs the exact-config system timer, and
removing the timer does not revoke per-request audit history. An absent or
uninstalled schedule leaves integration manual. The scheduled drain MUST NOT
perform convergence, push branches/remotes, weaken check requirements, or
invoke an AI provider. A concurrent contender must fail closed or wait, then
recompute its plan against
the new target and rerun exact-commit checks after convergence. A lost race
never justifies weakening checks. TORCH cannot prevent a user or agent with
independent forge credentials from bypassing its local queue; hosted branch
protection or credential isolation is defense in depth when available.

### Proposed nonnormative integration interpretation: candidate-source results

**Status: proposed design contribution only.** This interpretation does not
modify the preceding integration requirements or authorize a new check,
receipt, command, landing, or policy decision. If a future implementation
accepts a candidate-source result, it would be eligible only for the exact
unlanded commit and the complete proposed tuple in section 18; it would remain
distinct from an installed operational result and would require a fresh
operational run wherever that subject is required. Fixture attestations remain
nonpromotable and cannot satisfy an integration requirement.

The current registered schema/engine guard remains authoritative: the current
candidate CLI/engine initializes `ControlPlane`, requires schema 3, and must
refuse when the registered control plane is schema 2. A future product-schema-3
subject does not by itself require registered schema 3: a genuinely pure,
schema-agnostic engine plus authenticated schema-2-compatible adapter may be
considered only through an explicitly reviewed compatible tuple. This narrow
distinction must not globally invalidate existing schema-2 receipts that were
recorded under a compatible legacy adapter and their own exact-source contract.

The proposed initial CLI subject rule is resolved: it derives the authenticated
registered area and clean managed subject internally, with no caller selector
or initial expected-commit option. A future reviewed expected-commit comparison
could be a rejection-only freshness check against that already-derived subject,
never selection authority. Release still must name the command and decide its
presentation/refusal behavior; QA must settle scenario evidence and the exact
enforcement/store/fence design before implementation.

## 21. Doctor and observability

`torch doctor` is an observer and diagnostician, not an automatic repair tool.
It SHOULD report:

- domain-to-worktree and branch consistency;
- dirty files and in-progress Git operations;
- commits absent from the recoverability boundary;
- convergence drift measured by both count and age;
- pinned or actively measuring worktrees;
- session and presence state;
- prompt, roster, schedule, and generated-doc drift;
- missing dependencies or broken runtime integrations;
- message backlog and missing acknowledgements;
- resource holders and queue waiters;
- exact-SHA check validity;
- integration readiness;
- canonical Git and forge availability;
- local-only versus off-machine recoverability;
- installation-manifest inconsistencies.

Where runtimes expose usage data, observability SHOULD also report context
locality by Fleet identity: cached versus uncached input, cache creation and
read volume, compactions, resumed prompt size, and cost per verified item.
These metrics MUST identify whether they are measured or estimated and MUST
not treat a smaller prompt as success when verification quality declined.

Doctor output MUST distinguish observation from recommended action. Repair
commands require explicit invocation and normal authority checks.

Implementation checkpoint (2026-09-27): a read-only observation service and
`torch console snapshot` now expose project, health, identity, message,
backlog, check, resource, integration, delivery, schedule, and audit state
without initializing a missing database. The same snapshot exposes approved
ownership and neighbour relationships, managed worktree branch drift,
recoverability, acknowledgement state, tracked decisions, configured runtime
and delivery providers, and forge health. Context-locality output explicitly reports
`unavailable` until runtime usage samples exist, preventing estimates from
masquerading as measurements.

Identity-bound context telemetry now accepts provider measurements or explicit
estimates, never an unlabeled mixture. It records cached and uncached input,
cache creation and reads, compactions, resumed prompt size, micro-USD cost,
task/commit references, and verified item counts. Reports keep evidence classes
separate, derive cache-read ratio and cost per verified item, and warn when
usage has no verified outcome.

`torch doctor` additionally reports managed-worktree branch/commit consistency,
ahead and behind counts, the timestamp and age of the oldest missing canonical
commit, in-progress Git operations, configured runtime executable availability,
and the current commit's `ONE-DISK`, `LOCAL-REMOTE`, or `OFF-MACHINE`
recoverability grade. Each finding separates observed evidence from a
recommended action; doctor remains read-only.

## 22. Scheduling

### Owner clarification: integrated persistent operations (2026-09-30)

This is the target requirement; older implementation checkpoints describing
manual timer installation are not a claim that it is already implemented.
Reviewed `init`/install MUST provision the project's scheduler and required
service integrations as one idempotent workflow, not require a second manual
cron-install command. Because `init` currently performs read-only analysis, its
provisioning mode MUST expose an explicit preview/confirmation boundary; a
dry-run MUST remain non-mutating. Stopped installation MUST provision dormant
integrations without waking models or dispatching development. A reviewed
activation policy governs live operations and quota use.

Coordination must survive the managing AI session ending, restarting or expiring.
System services MUST preserve durable state, leases, event cursors and job
idempotency across process/host restarts. Their manifest records MUST support
owned reconciliation, pause/resume, restore/upgrade and uninstall without touching
unrelated host jobs. Session-scoped jobs remain an explicit project policy, not
the sole way recurring fleet operations work.

Project intake MUST propose applicable capabilities, with clear implemented,
unconfigured and unsupported states:

- direct-report manager check-ins, structured approval/peer/owner waits,
  stale owner-request review and an owner-first local digest;
- a persistent, serialized landing worker using approved exact-commit checks;
- resource-queue watchdogs, audited slot withdrawal and displaced-runner stop;
- durable significant events and deduplicated budgeted manager wakes, with
  low-frequency timed safety checks rather than perpetual paid polling;
- a project-declared nightly canonical suite, heavy-check windows and
  evidence-backed regression routing, not guessed blame;
- measured test durations, uncertain wait estimates and project-specific
  exclusive resources such as a GPU;
- conservative provider-neutral usage limits, graceful wind-down and explicitly
  approved credit-window or calendar restarts that never override manual pause;
- idle, clean, unguarded worktree convergence by merge, preserving conflicts,
  unique commits and active work;
- exact landed task closure, verified reversal/follow-up policy and reviewed
  evidence for finished-but-unnamed work, never automatic closure by message alone;
- project-specific local dev/Console services and separately authorized delivery,
  live-version checks and external notifications where relevant.

No universal project inherits COMBATRIG's release times, Monday reset time,
two GPU slots, Vercel destination, phone notifier or LAN/HTTPS exposure. Setup
MUST show lifetime, timezone/DST behavior, missed-run policy, costs/budgets,
ports/destinations, health evidence, stop semantics and owner authority. Unsupported
hosts/adapters need an actionable limitation or qualified fallback, not a fictitious
"installed" status. No provider wake, deploy, public message, off-machine write
or cleanup of unowned processes follows solely from creating a schedule.

TORCH recognizes two schedule classes.

**System schedules** survive AI sessions and may perform approved release,
backup, CI, mirroring, archival, dependency scan, or data-refresh work.

**Session schedules** exist while the Session Manager is active and may run
doctor, inspect drift, dispatch backlog, schedule QA, monitor resources,
monitor budget, or prepare wind-down.

Every schedule MUST declare:

- owner;
- lifetime;
- trigger;
- read-only or mutating behavior;
- command or action;
- required authority;
- retry and failure reporting;
- source of truth.

Schedules MUST be generated or validated from machine-readable configuration
so launcher code and prose cannot silently disagree.

Implementation checkpoint (2026-09-27): installed configuration carries
validated system and session schedules with owner, trigger, behavior,
shell-free action, authority, retry, failure recipient, and source-of-truth
fields. The service plans without mutation, blocks session schedules while the
Session Manager is offline, requires explicit approval for mutating actions,
records durable run evidence, retries deterministically, and reports failures
through durable blocker messages. CLI and MCP surfaces share the service.
System schedules can now use an owner-approved user-systemd launcher. The
launcher dispatches once per minute, evaluates the validated cron/interval
definitions in TORCH, suppresses duplicate minute runs, and refuses to run
after tracked configuration changes because its command is bound to the exact
configuration digest. Unit files are recorded in the installation ownership
manifest and removal refuses changed files. Installing that persistent
launcher on a real machine remains an explicit owner action. When a reviewed
configuration change changes its digest, `torch schedules launcher
plan-reconcile` previews the exact owned-unit refresh and `reconcile --yes`
updates only unchanged TORCH-owned units, reloads the user systemd manager, and
updates the ownership manifest. Modified, missing, or mismatched units block
reconciliation; a failed reload restores the previous unit contents and
manifest. This refresh does not alter the timer cadence or start an AI runtime.

Manager check-ins are a required schedule capability. Each manager-level
identity MUST have a configurable cadence and a scope derived from its direct
reports in the active organization graph (not a hard-coded list of agent
names). Interval-based manager check-ins MUST be at least 60 seconds apart;
cron schedules retain their minute-level resolution. A check-in observes
durable status, current task, unacknowledged
coordination/blocker/handoff messages, and explicit approval-wait records when
available; ambiguous `waiting` summaries are surfaced as unclassified rather
than guessed. It prepares a concise, durable check-in request for that manager
with affected identities, evidence, and the next useful action. Check-ins MUST
not grant approval, reassign work, alter a backlog item, or create a new agent.
If the manager is offline, the check-in remains queued for resume. Waking a
runtime to consume the check-in is an adapter-mediated provider invocation.
It MUST be disabled by default and, if enabled by the owner in the reviewed
schedule, MUST select an explicit budget policy and a durable project-wide
maximum invocation count shared across all manager schedules per UTC day.
`action.wake.budget_mode: invocation-count` supports subscription and local
runtimes and bounds the number of invocations, not dollar spending.
`action.wake.budget_mode: usd-hard-cap` additionally requires a positive
`action.wake.max_usd_per_invocation` and an adapter-enforced USD ceiling for the
exact create/resume mode. Legacy configurations providing the positive USD
ceiling without a mode retain USD-hard-cap behavior. An enabled wake without
either policy is invalid. Count mode cannot specify a USD ceiling.
TORCH MUST skip a wake when the manager is already active,
preflight the exact configured identity and any required ceiling, reserve the daily count
atomically only after that preflight, and invoke using the same prepared plan,
adapter, and profile. A failed or unavailable adapter MUST leave the durable
check-in queued and report the failed wake. A missing or mismatched hard-cap
receipt in USD-hard-cap mode MUST fail closed before reservation/invocation. The daily invocation
count and per-invocation USD ceiling are independent safeguards; neither
replaces the other. The portable base behavior is durable delivery, not silent
provider use. The owner configures the shared cap through
`runtime_wake_budget.max_invocations_per_day`. Timer installation remains a
separate owner-approved operation.

Adapters MUST NOT claim a hard cost ceiling for subscription or account-based
usage unless the underlying runtime provides an enforceable limit. The current
built-in Claude, Codex, and Pi adapters declare no hard-cap-capable launch
modes; their USD-hard-cap scheduled wakes are rejected during preflight and
check-ins remain queued. Explicit count-limited wakes can use their ordinary
configured launch/resume modes. Pi still requires an explicit provider/model.

When adapter preflight was unavailable, a later timer tick MUST be able to wake
the existing pending check-in without creating a duplicate message. Each
message has at most one reserved invocation; retries must not silently repeat
a possibly executed provider call. Reservation MUST atomically reject another
in-flight wake for the same manager, and recheck current manager state before
invoking. Unknown or interrupted reserved invocations remain visible for
operational recovery rather than being cleared based on age alone.

`torch schedules wakes [--manager <id>]` provides read-only reservation
inspection, including outcome, message, manager state and whether a reservation
blocks another wake. Recovery uses `torch schedules recover-wake --reservation
<id> --runtime-stopped --note <evidence> --yes`. Only the configured owner may
recover an interrupted `reserved` record, and the manager must be offline.
The owner MUST first inspect and stop any associated runtime outside this
command; an offline heartbeat alone is not process proof. TORCH records this
as an operator attestation, not verified runtime termination. Recovery is
atomic and audited, retains the budget charge and same-message replay guard,
and neither acknowledges the check-in nor launches a provider. A fresh check-in
can wake only through the ordinary schedule after the owner handles the old
message. Age, message acknowledgement, and routine timer ticks never recover
unknown launches automatically.

The read-only project snapshot MUST expose initialized manager launch records
and the total number of blocking unknown launches, or explicitly report that
records are unavailable. A bounded history prioritizes blocking reservations.
The Console surfaces them in owner attention and schedule operations with
manager, schedule, message, reservation and presence details. Navigation to
these details opens any collapsed ancestor panel. Observation MUST NOT clear,
acknowledge, recover or retry a reservation, and offline presence MUST NOT be
presented as independent runtime termination evidence.

When TORCH proposes an organization graph, it MUST derive a check-in schedule
for every non-owner identity with direct reports. Existing schedules and their
configured cadence are preserved; a newly required manager receives a
15-minute owner-authorized system coordination schedule in the proposal. A
hierarchy-change plan MUST show schedule additions and obsolete schedule
candidates. Obsolete timer definitions are not removed automatically, and a
proposed schedule is not an installed timer: activation must preserve the
separate owner approval and installation boundary. One project timer may
dispatch multiple manager schedules; each schedule queues work only for its
own manager and direct-report set.
The owner-facing hierarchy review preview MUST show that same schedule delta,
label timer installation as unverified, and state that changes to the tracked
configuration require separate reconciliation of any exact-config timer
launcher before it is trusted. The owner can inspect and explicitly apply that
refresh through the launcher reconciliation commands; hierarchy planning and
activation MUST NOT silently change user systemd state. Showing a schedule MUST NOT imply that a
manager runtime will be awakened; provider invocation requires its own
explicitly enabled budget and policy.

Every generated start/resume instruction bundle for an identity with direct
reports MUST explain its manager-check-in responsibility: inspect durable
check-in messages, refresh current state through the identity-bound
`torch_plan_manager_check_in` tool, act only within the manager's authority,
and route approval requests to their named approver. Specialist-only bundles
MUST NOT imply manager authority. Rebuilding the bundle from the current
organization graph ensures a promoted identity receives these instructions on
its next start or resume, without silently changing a running session.

Approval waits MUST be represented as durable structured requests rather than
inferred from presence summaries or free-text messages. A request names its
requester, exactly one approver (a configured owner or active Fleet identity),
optional task and evidence references, a bounded title and summary, state,
revision, and decision metadata. Only the named approver may decide it. A
decision is revision-checked, audited, and durably returned to the requester.
An owner decision requires the explicit owner CLI confirmation path; AI
identities cannot claim or decide as the owner. A manager check-in includes
pending requests made by direct reports and classifies the wait target as that
manager, another AI identity, or the owner. Managers may route or escalate a
request but MUST NOT approve it for a different named approver. The owner and
each AI identity may list only requests they made or are named to approve;
manager check-in may inspect requests made by its direct reports.

### Routine coordination and owner decision boundary

TORCH SHOULD minimize human relay work, not minimize truthful escalation. Within
explicitly approved project/task policy, specialists read and acknowledge their
own addressed messages, resolve peer interface questions, decide only approvals
for which they are the named responsible approver, and maintain truthful task,
wait, evidence and local owned-work checkpoints. Managers route unresolved peer
requests, follow their direct-report waits and compress outcomes for the owner.
Reading/acknowledging a message MUST NOT close its unresolved approval or task.

Before escalating to the owner, inspect the current named approver, responsible
domain, applicable policy, prior decision and evidence. An authorized routine
action SHOULD be completed and audited instead of asking the human to relay or
repeat the instruction. An unauthorized action remains blocked with a specific
request to the responsible party. Owner requests contain evidence, options,
recommendation and consequences, not only internal error codes.

Project policy MUST distinguish routine authorized actions, investigation-only
signals and genuine owner decisions. Health warnings, stale presence, branch
drift, budget exhaustion, incomplete checks or missing evidence do not grant
permission to recover, delete, merge, start another runtime or waive a gate.
Spending/publication/deployment, material scope or ownership changes, identity
activation, destructive or uncertain recovery and owner-addressed approvals
remain subject to their explicit owner authorization. A paused fleet and its
budgets remain enforced even when a manager believes action would be useful.

Current pilot checkpoint: canonical live COMMON/manager instructions now teach
this boundary. `TASK-bounded-routine-coordination` carries portable generated
instruction and behavioral qualification work; the owner authorizes this bounded
Project Kernel slice, not general unattended execution. Automatic AI wakes remain
paused pending executor qualification.

Implementation checkpoint (2026-09-28): `planManagerCheckIn` derives direct
reports from the active organization graph and reports offline/stale/waiting
identities plus unacknowledged direct-report messages. `queueManagerCheckIn`
creates at most one unacknowledged self-directed manager-check-in message, does
not queue when no attention is needed, and never invokes a runtime. Formal
approval requests now persist in SQLite, are identity-scoped, notify named AI
approvers, and allow only the named approver to record an audited,
revision-checked decision. Owner decisions require explicit CLI confirmation.
Check-in plans include direct-report approval waits classified by target.
Queued check-ins include a capture timestamp and explicitly identify their
findings as a potentially stale snapshot. Before taking action, the manager
MUST refresh direct-report presence, unacknowledged messages, and structured
approval waits from current durable state through the read-only,
identity-bound `torch_plan_manager_check_in` MCP tool. The tool derives scope
from the active organization graph, accepts no caller-selected manager ID, and
grants no decision authority; named approvers remain the only identities that
may decide their requests. Pending-message deduplication therefore cannot make
a later approval or blocker invisible to the manager's fresh check-in.
A manager-check-in action MAY opt into `stale_work` review bounds:
`stale_days` (1–365), `max_commits` (1–10000) and `max_items` (1–100), defaulting
to approved backlog activity bounds and 30 items. An owner-approved daily cron
schedule can deliver this review; cron evaluates host-local time. No such review
schedule or host timer is installed automatically.

Reviews MUST use the authoritative existing backlog, prioritize owner requests,
scope assigned tasks to direct reports, and reserve unassigned intake for Fleet
Operations. Blocked items MUST remain marked as expected waiting; incomplete
Git coverage is unknown, not evidence of neglected work. Output MUST be bounded
and MUST NOT modify task state, ownership, approvals or completion evidence.
Stale reviews deduplicate separately from routine check-ins so an outstanding
routine message cannot swallow the daily review. Before acting, managers refresh
`torch_plan_manager_check_in` with `stale_work_review: true` and the stated bounds.
Revival, deferral, dependency resolution and evidenced closure remain explicit
decisions through the existing task/approval mechanisms. Optional runtime wakes
retain existing owner approval and budget guards; inbox delivery alone never
starts an AI session.
New deterministic proposals derive 15-minute schedules for each manager
identity with direct reports. Hierarchy pilot plans now show missing manager
schedule additions and obsolete schedule candidates without applying either.
Configuration validation requires every configured manager to have its own
typed schedule. The typed coordination action is handled by `ScheduleService`
and dispatched by the existing owner-approved system timer. The timer only
queues a durable check-in; it does not wake a live AI runtime. Applying a
hierarchy change and reconciling installed timer state remain separate gates.
The local Console includes Flow watch for managers, direct reports, approval
targets, and configured cadence; it explicitly reports timer installation as
unverified. Snapshot observation remains read-only. For a pending request whose
named approver is the owner, the Console MAY offer a same-origin loopback
preview-and-confirm decision control. Preview MUST show the request revision,
requester, evidence, selected decision, note, and exact effect. Confirmation
MUST re-check the named approver and request revision, use the existing audited
`decideApproval` transaction, and notify the requester exactly once; stale or
replayed requests MUST NOT apply a second decision. The owner Console MUST NOT
decide requests assigned to a manager or peer AI, and MUST make that boundary
visible. Explicit adapter-mediated runtime wake with a per-project budget
remains separate and disabled by default.

## 23. Repository and forge operating modes

### 23.1 Local-only mode

Local-only mode is a production-supported baseline, not a demo. It requires:

```text
laptop
Git
TORCH
supported agent runtime
runtime/model credentials, if applicable
project repository
```

TORCH supplies worktrees, identities, messages, presence, backlog, decisions,
checks, resources, integration, and restart state locally.

If a project has no remote, TORCH SHOULD offer a local bare canonical Git store
under its machine-local project state. This preserves normal fetch/push and
shared-ref semantics.

Doctor MUST distinguish:

```text
ONE-DISK       commit exists in only one working repository
LOCAL-REMOTE   commit also exists in a local bare canonical store
OFF-MACHINE    commit exists on another machine or provider
```

A local bare repository is not an off-machine backup.

### 23.2 Forge-backed mode

A forge adapter MAY provide remote hosting, pull requests, code review UI,
hosted CI, issues, releases, branch protection, artifacts, and repository web
browsing. Each capability is independently optional.

Valid configurations include GitHub for mirroring while TORCH remains the
integration and check provider, or GitHub Actions for checks while TORCH keeps
its own backlog and integration queue.

Publishing the already-landed local canonical branch is a separate owner-only
operation; it is not part of specialist integration or the scheduled
integration drain. `torch forge sync plan` MUST be read-only, and
`torch forge sync --yes` MUST require explicit confirmation, verify that the
configured forge remote is still the canonical remote, and publish only the
current canonical commit. The operation MUST use a normal fast-forward-only
Git push, MUST NOT force-push, and MUST record the owner, exact commit, remote,
branch, and observed result in the local audit log. A remote-ahead or divergent
branch MUST block publication; TORCH MUST NOT fetch-and-merge, overwrite, or
silently select one history. The owner must first fetch and explicitly
converge the canonical branch, then rerun any required checks invalidated by
that convergence. A push race MUST fail without rewriting the remote. Forge
unavailability MUST leave local integration and coordination operational;
publication can be retried after service returns.

### 23.3 Degraded operation

Loss of a forge MUST NOT destroy local identities, messages, commits, checks,
backlog, or coordination. Doctor reports delayed remote synchronization.
Whether integration may continue is a project policy decision.

### 23.4 Migration

Attaching or detaching a forge MUST preserve domain identities, worktrees,
backlog, decisions, and local state. TORCH verifies ref equivalence before
changing the canonical Git store.

## 24. Releases and deployments

Release storage and deployment are provider adapters. Examples include
filesystem, GitHub Releases, object storage, Vercel, or custom commands.

TORCH MUST distinguish:

```text
implemented
verified
integrated
release-ready
released
deployed
live-verified
```

Integration authority does not imply deployment authority. Project
configuration MUST state who may perform each transition. Secrets are resolved
at execution time from approved external stores and never copied into tracked
Fleet state.

Implementation checkpoint (2026-09-27): TORCH now persists this complete state
machine in the local control plane. Creation requires a clean, exact source
worktree tip and evidence; verification requires the configured exact-commit
check receipts; integration requires a landed request for that commit; and
release, deployment, and live verification require separately configured
provider capabilities, state-specific authority, evidence, successful adapter
receipts, and explicit owner approval. Fresh installations configure both
provider slots as `none`, so no external release or deployment can occur by
default. The CLI and read-only Fleet observation surface are implemented and
scenario-tested with a virtual adapter; no live release or deployment was
performed.

### 24.1 Durable delivery attempts and bounded retries

Before external execution, TORCH persists a per-delivery unresolved operation
reservation and a running attempt. Independent callers MUST NOT overlap that
delivery's effects. Each attempt records operation, exact commit, provider,
ordinal, timestamps, result and structured receipt. Failed attempts persist
without advancing delivery state. Successful receipt application, delivery
state, lifecycle event and audit are committed together; if local application
fails after external success, the unresolved successful operation prevents
duplicate execution. Console observation includes bounded recent operations
and attempts; detailed receipts are available through CLI.

Approved `delivery.retry.max_attempts` is 1–5, default 1. Retry requires both an
adapter declaration of `retrySafety[operation]` (`idempotent` or `read-only`)
and a structured failed receipt reporting transient classification and effects
`not-applied`. All bounded attempts share one idempotency key. Adapters must
actually honor their safety declaration/key and omit secrets from receipts;
TORCH does not independently prove provider-side behavior. Permanent failures,
undeclared safety, unknown effects, thrown exceptions and malformed receipts
MUST NOT auto-retry. Fresh canonical policy is checked before execution and
every retry; changed policy stops further effects. Existing authority/evidence
and high-impact owner-approval gates still apply. This boundary is synchronous;
Promise-returning adapters are unsupported and treated as uncertain.

Unresolved interrupted/unknown execution remains blocked for review. Only the
owner, after confirming the executor is stopped and independently verifying no
external effect, may explicitly attest `not-applied` with evidence. This clears
the reservation without executing anything or advancing lifecycle state, and
preserves the original uncertain attempt plus owner-attested provenance.
Do not use this for succeeded operations. Saved successful receipts whose
local lifecycle application failed have a separate owner-only preview and
explicit executor-stopped reconciliation path. It MUST invoke no adapter,
require the exact delivery commit/from-state/next-state and latest successful
receipt, check current owner authority and unchanged destination configuration,
and commit lifecycle/event/audit/operation application atomically once. A running
parent with a durably saved successful latest attempt can be reconciled after
the owner confirms its executor stopped; unknown/failed receipts cannot.
Replays are unchanged and partial local recovery rolls back without losing the
receipt. Destination hashes are additive metadata; older records without them
require the complete original policy hash. Unrelated configuration changes do
not invalidate newer destination-bound records. Saved adapter success and owner
review are reported provenance, not independent live deployment verification.
Actual provider adapters/idempotency qualification, canonical fetch retry and
dashboard details remain open.
No configured provider name alone installs or executes an adapter.

## 25. Security and trust boundaries

### Owner-first digest checkpoint (2026-09-30)

TORCH provides read-only Markdown/JSON owner digest generation over a configurable
rolling UTC window (1–168 hours, default 24) with bounded section results
(1–100 items, default 30). Owner approval waits come first, followed by unresolved
delivery review, latest deployment operation, receipt-reported shipping, landed
work, completed tasks, structured approval decisions, blockers and neglected
owner requests. Implemented or landed work MUST NOT be relabelled as shipped.
Missing tables and truncated source/results MUST be explicit; incomplete managed
Git history cannot prove neglected requests. Project text is escaped for Markdown.
Database reads share a transaction; tracked worktree/Git state remains a bounded
observation, not an atomic repository snapshot or independent live verification.

Approved publication persists an immutable local report plus audit atomically.
Owner publication requires explicit approval; Fleet Operations automatic
publication requires current `owner_digest.enabled` policy. A typed
`owner-digest` system coordination schedule requires owner authority and one
attempt, honors policy revocation and wakes no agent or external command.
No timer is installed by configuration or report publication. Latest reports
are available through CLI, console snapshot and read-only `/api/digest` JSON.
Unstructured decision documents are not time-indexed and cannot be presented
as complete recent management calls. The actual Console and isolated demo share
a read-only owner briefing renderer and navigation anchor. It shows saved
publication time/window, owner attention first, delivery uncertainty, distinct
recorded shipping/landing/completion, expandable decisions/blockers and coverage.
Unpublished, stale, future-clock and unavailable/truncated evidence are explicit.
Project strings are escaped as text; report Markdown is never interpreted as
trusted HTML. A saved report is not silently rewritten after a live approval
changes. Mobile anchors clear sticky navigation, and expanded evidence fits the
viewport. Explicit external notification adapters and installed-cadence
qualification remain pending. Local publication MUST NOT imply public release or external
delivery. The authoritative backlog remains unchanged by reporting.

Check-evidence dashboard checkpoint (2026-09-30): the Console and isolated
demo share an escaped, expandable view of exact-commit receipts, captured-input
digests/copy strategy, invalidation reasons and project-reported pre/post
condition observations. Project-scoped read-only database projection supports
legacy receipts without condition columns; malformed or absent evidence is
explicit. Preparation records remain visible without assuming a recorded
running state proves a live process. No automatic retry or recovery authority
is introduced. History is bounded to the latest 40 receipts and preparations;
linked captured-input evidence is resolved independently of the preparation
display limit. Local filesystem paths and per-file inventories are not exposed
by this view. Actual GPU/browser qualification remains a separate gate.

Activity dashboard checkpoint (2026-09-30): read-only snapshots reuse managed
Git commit observation with approved project stale-day/scan bounds. Task creation
time and originating owner identity are preserved in the projection. The shared
Console/demo Activity review groups stale work separately from unknown activity,
puts owner requests first and retains expected blocked-wait context. Neglected
owner requests surface in the attention list. Commit closure mentions are intent,
not completion evidence; metadata edits do not reset inactivity. Observation
neither creates a second queue nor changes task state. A configured daily review
and non-disruptive live refresh still need implementation/qualification.

Canonical fetch checkpoint (2026-09-30): `torch forge fetch plan` resolves the
configured canonical branch, then owner-confirmed `forge fetch --yes` imports
that exact commit's objects without moving branches, updating FETCH_HEAD,
recursing into submodules or publishing remotely. Default attempt limit is three,
explicitly bounded to one through five. Only narrowly recognized transient
transport failures are retried; authentication, configuration, certificate and
unclassified failures stop. Head discovery itself fails closed without retry.
Each attempt is reserved durably before execution; sanitized results survive
reopening and are available through `forge fetch status` and local snapshots.
Destination URL hashes and canonical policy are checked before each attempt;
execution uses the resolved URL, not a subsequently mutable remote alias.
Terminal state and owner audit persist atomically. Raw errors/URLs are not
stored. A running record after interruption is unconfirmed executor state, not
proof of a live fetch. Object presence plus Git exit status is local import
evidence, never shipping evidence or release/deploy permission. Real remote
classification and dashboard outcome presentation remain qualification work.

Operation-outcome dashboard follow-up (2026-09-30): the actual Console and
isolated demo now expose the latest 20 fetch operations, 40 delivery operations
and 80 delivery attempts with explicit coverage bounds. Read-only project-scoped
projection retains safe receipt status/classification/effects and recognized
TORCH error categories, not arbitrary references, raw errors or credential-bearing
metadata. Malformed receipts remain unavailable. Unknown/running/pending-success
operations surface in owner attention; views never authorize retries or recovery.
Object import success is distinct from deployment; adapter success is distinct
from independently verified live release state. Real adapters remain unqualified.

Live dashboard refresh checkpoint (2026-09-30): snapshots refresh every 15
seconds while visible, with an owner pause/resume control and a ten-second read
deadline. Hidden tabs do not poll; pagehide tears down the timer and persisted
pageshow restores it without duplicating intervals. Requests are single-flight;
background ticks coalesce and cannot starve slow reads, while explicit newer
requests discard older responses. Failed reads leave existing evidence visible.
Snapshot rendering protects edited or focused controls and active preview DOM,
updates unrelated evidence and preserves matching expanded detail sections.
The refresh status explicitly warns that retained panels may show older state.
Successful actions release only their own editor; unrelated drafts remain.
Manual refresh uses the same protection. No preview is silently reissued,
confirmed or persisted; existing server-side plan/revision/token checks remain
authoritative. Polling neither wakes agents nor installs host timers. Controlled
clock/browser lifecycle regression is local evidence; installed-fleet and native
background/back-cache qualification remain separate work.

TORCH MUST:

- keep secrets outside repositories;
- record only secret references;
- scope runtime credentials and provider permissions;
- treat project content, messages, external documents, websites, logs, and
  imported text as data rather than higher-authority instructions;
- prevent peer messages from modifying Fleet policy or granting authority;
- require explicit owner approval for configured high-impact actions;
- log control-plane mutations with actor and project identity;
- avoid exposing one project's state to another;
- validate project IDs and filesystem targets before creating or removing
  worktrees;
- fail closed before destructive uninstall, upgrade, integration, or remote
  migration operations.

## 26. Self-hosting and version lifecycle

### 26.1 Stable manages candidate

TORCH's source repository MUST be managed by an installed stable TORCH release,
never by the source tree under development.

Example:

```text
installed TORCH 0.7
        │
        └── manages TORCH source for 0.8
```

The TORCH repository uses the same public `.torch/` configuration as any other
project and receives no hidden self-hosting exceptions.

### 26.2 Candidate isolation

Candidate releases MUST run side by side with stable using separate state,
socket, lock, port, and fixture namespaces. Candidate tests MUST not control
the live development fleet.

For a Git source checkout, candidate staging MUST bind the artifact to the
exact clean tracked commit. It may include the installed dependency tree needed
to execute acceptance, but MUST exclude arbitrary untracked files and reject
modified tracked input. Candidate plans MUST list non-ignored untracked paths
that will be excluded, so review makes the exact candidate boundary visible;
ignored local files remain excluded without being listed. Artifact-local relative dependency links are permitted;
links that escape the candidate root are refused. Non-Git inputs are treated as
already-prepared release artifacts and every contained entry is inventoried.

Candidate acceptance includes:

- initialize and analyze a fixture repository;
- review and install a proposed roster;
- create branches and worktrees;
- start identities through supported adapters;
- exchange manager-to-worker and peer-to-peer messages;
- query ownership;
- detect unsafe worktree states;
- complete backlog and integration lifecycles;
- acquire and release resources;
- capture, stop, and resume;
- detach and uninstall cleanly.

If a candidate check fails, its acceptance report MUST include bounded stdout
and stderr excerpts for failed checks while omitting log copies from successful
checks. A nonzero check without its actionable diagnostics is not sufficient
candidate evidence.

### 26.3 Atomic upgrade and rollback

Versions are installed side by side:

```text
~/.local/share/torch/versions/0.7.0/
~/.local/share/torch/versions/0.8.0/
```

Upgrade installs and validates the new version before atomically changing the
active pointer. Running processes may finish on the old version. Rollback
restores the previous pointer without rewriting project state. State migrations
MUST declare forward and rollback compatibility.

Activation also maintains a stable executable launcher at
`~/.local/bin/torch` (or an explicitly configured installation bin directory)
that resolves through the atomic active-version pointer. Candidate validation
hashes executable modes as well as bytes, rejects a non-executable TORCH binary,
and refuses to replace a launcher path not owned by that installation.

## 27. User interfaces

### 27.1 CLI

The target command surface includes:

```text
torch init
torch analyze
torch domains
torch install
torch detach
torch uninstall
torch up
torch up --fresh
torch up --only <domains>
torch down
torch capture
torch list
torch brief
torch doctor
torch backlog
torch message
torch status
torch checks
torch resources
torch integrate
torch schedules
torch candidate build
torch candidate test
torch upgrade
torch rollback
```

Commands MUST offer structured output where automation needs it.

### 27.2 Local Fleet Console

The operational console SHOULD expose:

- agents and presence;
- ownership and domain graph;
- worktrees, branches, drift, and recoverability;
- messages and acknowledgements;
- backlog and blockers;
- checks and exact tested commits;
- integration queue;
- resource holders and waiters;
- decisions, schedules, releases, and provider health.

The console is an operational view over the same core service, not a separate
source of truth.

The owner-facing console SHOULD open with a project pulse and an explicit
attention queue, then provide project-aware views over the authoritative
backlog, persistent identities, durable inter-session communications, evidence,
integration, and release gates. Kanban lanes are projections of backlog states;
they MUST NOT create another queue. The roster and enabled capabilities drive
navigation and grouping; the interface MUST NOT assume COMBATRIG departments or
another project's role names.

The organization view SHOULD also show the exact manager-aware startup order
and reverse wind-down order derived from the approved reporting graph. It MUST
use the same ordering policy as runtime lifecycle planning, expose missing
identity or reporting-cycle blockers, and remain a read-only preview; it MUST
NOT start or stop sessions or infer live presence from the planned order.

The console SHOULD let an owner filter the backlog by project-observed task,
owner, state, priority, domain, feature, and milestone values, then save, update,
select, or delete named views. Saved views are presentation preferences stored in browser-local
storage under a stable project identity; they MUST NOT write to the repository,
control plane, or task records. Unavailable browser storage MUST leave the
backlog usable and explain that views could not be saved. Saved view data MUST
be schema-validated and bounded, and malformed preferences MUST fail closed to
the unfiltered authoritative backlog.

The Console SHOULD summarize each explicitly labeled feature and milestone
from its linked backlog task states, including completion, active work, review,
and blockers. Canceled tasks MUST be visible but excluded from completion
denominators. The summary MUST disclose that it is a task-state projection;
checks, integration, release, deployment, and live verification remain separate
gates and MUST NOT be inferred from a percentage or completed task count. Work
without labels remains ungrouped; the Console MUST NOT infer or invent feature
names from file paths or domain titles.

The local Console MAY let the project owner change a backlog task's priority.
Such an action MUST be restricted to same-origin loopback requests, require an
explicit reason, bind a short-lived single-use preview to the exact task,
revision, old/new priority, and reason, and require a separate confirmation.
Applying it MUST re-check the task revision and record an audit/history event.
It MUST NOT change task state, owner, dependencies, evidence, or integration
gates. Stale, expired, replayed, cross-origin, and malformed requests MUST
fail without mutation. This narrow control does not grant general backlog,
identity, lifecycle, or provider-launch access.

Screenshots and review artifacts MUST carry task, identity/session, and commit
provenance. Owner comments and annotations MUST route through the responsible
identity or become durable backlog work; the UI MUST NOT expose private model
chain-of-thought. Test receipts, integration, release readiness, deployment,
and live verification are separate evidence states. The console MUST label
stale or unavailable data rather than presenting it as current.

The initial local artifact catalog stores bounded PNG, JPEG, WebP, or GIF image
bytes in private external project state, not in the repository. A publisher
MUST own the referenced backlog task, use a managed identity worktree, provide
the full commit SHA and stable identity, and have the active runtime session ID
captured when available. TORCH MUST reject path traversal and symbolic links,
record a content digest, and verify that digest before serving an image. Owner
feedback MUST preview the artifact, task, responsible identity, commit, and
durable-message effect; only the configured owner may confirm it. Feedback is
stored in the durable message stream rather than a parallel comment ledger.

The observation endpoint remains GET-only. The local Console may expose a
narrow owner feedback action: a same-origin loopback preview issues a
single-use token bound to the exact message effect, and confirmation must
recompute and match that preview within five minutes. Cross-origin requests,
stale previews, expired tokens, and replayed confirmations MUST fail without
creating a message. This is not general write access to the Fleet.

Other owner controls MUST preview the target, effects, evidence, and authority
required before invoking a separately authorized control-plane operation. A
dashboard button MUST NOT itself bypass authorization for runtime launch, task
reassignment, worktree removal, canonical integration, release, deployment,
or spending. Preserve the read-only observation API and test UI preview and
API authorization separately.

The owner Console MAY accept or reject Fleet-evolution proposals and may
approve a hierarchy proposal for bounded-pilot planning, defer it, or reject
it. These actions MUST update the existing durable proposal records rather
than create a dashboard-only queue. Each action MUST use a same-origin loopback
preview and a short-lived, single-use confirmation bound to the exact proposal,
decision, reason, active organization graph, and repository head. Confirmation
MUST recompute that scope and fail closed if it changed. Approving a Fleet
change authorizes only a later activation review; it MUST NOT provision an
identity, create or remove worktrees, or start a runtime. Approving a hierarchy
proposal authorizes planning only; it MUST NOT activate the proposed graph or
start/create identities. A distinct owner-confirmed CLI activation requires a
fresh plan and commits only the approved graph, derived check-in schedules,
install-manifest hashes, and pilot record; it still MUST NOT provision or launch
identities or modify user systemd state. Timer reconciliation is a separate
owner-confirmed command. Decisions MUST retain their durable audit trail.

The owner Console MAY also expose persistent schedule-timer setup and refresh.
It MUST distinguish configured schedules from TORCH-owned unit files and MUST
state that file ownership/digest does not verify the timer's live systemd
state. Before installation or reconciliation it MUST show every affected
system schedule, its trigger, behavior, action, wake policy, unit paths, and
configuration digest. Only a same-origin loopback preview followed by a
single-use, five-minute confirmation bound to the exact action and current
configuration may write units, reload systemd, or enable/start the timer.
Confirmation MUST recheck exact unit ownership and refuse stale, modified,
missing, or mismatched units. The operation MUST record owner audit evidence.
Starting the timer may dispatch configured due system schedules; it MUST NOT
silently enable provider wake, weaken action authority, or start a Fleet
identity directly.

The owner Console MAY also let the owner send a bounded request to one
identity in the approved Fleet roster, optionally linked to an existing active
backlog item. It MUST preview the exact recipient, message, task reference,
owner authority, active organization, and repository head before confirmation.
Confirmation MUST recompute that scope and use a short-lived single-use token;
stale, expired, replayed, cross-origin, and malformed requests MUST fail
without writing. A confirmed request is one ordinary durable inbox message in
the existing conversation stream, with owner identity and audit provenance.
It MUST NOT create or change a task, transfer ownership, change presence, wake
or start a runtime, or expand the recipient's authority. The request remains
subject to the agent's scope and all existing approval gates.

### 27.3 Public website

The public website MUST be redesigned around the new product. It MUST NOT
describe Nostr task locks, relay coordination, the old scheduler, or a catalog
of generic agents.

Its primary story is:

```text
owner request
→ Session Manager routing
→ domain-owned worktrees
→ direct coordination
→ exact-commit verification
→ controlled convergence
→ canonical main
```

The site SHOULD separate product explanation and documentation from the local
Fleet Console. A distinctive routing or dispatch-board visualization should
demonstrate the system more clearly than a wall of feature cards.

The dashboard demo MUST open the actual Fleet Console in a separate browser
tab, using the same markup, renderer, and controls with sample project data.
Its link label is `View dashboard demo`; browser-tab behavior does not belong
in the visible label or page title. Sample actions MUST stay in the visitor's
tab and MUST NOT contact live project APIs or start agents, timers, or provider
invocations. The demo MUST label its sample workspace, support reset, and
demonstrate project work, agents, direct communication, review artifacts,
owner decisions, and runtime profiles. A separate miniature dashboard is not
an acceptable substitute for the product interface.

Recommended product language:

> One repository. A coordinated AI engineering team.

TORCH SHOULD be treated as the product name rather than retaining the legacy
"Task Orchestration via Relay-Coordinated Handoff" expansion.

## 28. Delivery plan

### Stage 0: Preserve and specify

- archive the legacy Nostr main line;
- preserve the development-network experiment separately;
- establish a clean rewrite branch;
- accept this specification and record any amendments;
- define scenario IDs and fixture repositories.

Exit gate: the owner approves the product boundary and legacy preservation
plan.

Implementation checkpoint (2026-09-27): the former Nostr product is preserved
at `legacy/nostr-torch`, the development-network experiment is preserved at
`legacy/development-network-v2`, and active development occurs on
`rewrite/portable-agent-fleet`. Once the replacement kernel and its acceptance
suite were established, Nostr-era runtime code, dashboards, generated output,
task logs, fixtures, and tests were removed from the rewrite branch rather
than carried as a misleading second product. The legacy branches remain the
recovery and history boundary.

### Stage 1: Portable kernel

- configuration schema and loader;
- project identity and XDG state layout;
- read-only `init` and `analyze` scaffolding;
- install manifest;
- detach, uninstall dry-run, and doctor foundation;
- Git repository and worktree inspection.

Exit gate: installation and complete reversal succeed on a fixture repository
without modifying user code.

### Stage 2: Project decomposition

- reconnaissance and architecture graph;
- domain proposal and collision analysis;
- human review artifact;
- roster, prompt, backlog, and worktree generation;
- bootstrap acceptance test.

Exit gate: two structurally different fixture repositories receive defensible,
reviewable organizations.

Implementation checkpoint (2026-09-27): `torch analyze` and `torch design`
accept `--repo` plus repeatable `--spec` inputs. Markdown specifications are
read without execution, reduced to evidence-linked responsibilities and
domain signals, fingerprinted, and checked again at approval. A spec-first
fixture demonstrates project-specific responsibilities with intentionally
unresolved path ownership; a separate repository fixture continues to prove
code-derived architecture and collision boundaries. Both paths remain
read-only until an approved install.

Repository analysis also includes unignored working-tree source files and binds
proposals to a recomputed working-tree fingerprint. Drift in tracked or
untracked analysis inputs invalidates approval even when `HEAD` has not moved.

`torch bootstrap` now emits the provider-independent Session Architect brief.
Its scenario proves that a mixed code/spec project exposes omitted components
and unmatched goals for AI reasoning, forbids copying COMBATRIG or a generic
catalog, and preserves owner-only approval without mutating the project. The
brief also requires an evidence-backed flat-versus-coordination assessment;
proposal validation requires integrated outcomes and authority boundaries for
any lead, and rejects implementation or owner-approval grants while preserving
direct peer communication (`SCN-architect-organization-assessment`).

`torch architect plan`, `validate`, and explicitly authorized `run` now carry
that brief through isolated Claude or Codex planning and semantic validation.
Automated coverage uses virtualized provider output; no live model usage is
implied by the passing scenario.

### Stage 3: Claude reference fleet

- control-plane service and MCP server;
- Claude adapter;
- identity, presence, messages, acknowledgement, and lifecycle;
- Session Manager and domain startup;
- capture, wind-down, and resume.

Exit gate: a local Claude fleet completes a bounded multi-domain change and
resumes after shutdown.

### Stage 4: Verification and integration

- checks and exact-SHA receipts;
- resource queues and leases;
- doctor completeness;
- convergence workflow;
- integration queue and main policy;
- local bare canonical Git store.

Exit gate: a local-only fleet can take a change from assignment through tested
integration without GitHub or hosted CI.

### Stage 5: Runtime portability

- Codex adapter;
- mixed-runtime fleet;
- CLI fallback for MCP-limited environments;
- capability reporting and degraded behavior.

Exit gate: Claude and Codex occupy persistent domains in one Fleet and
coordinate through TORCH rather than native vendor messaging.

Implementation checkpoint (2026-09-27): the Codex adapter, mixed-runtime
planning, invocation-scoped identity-bound MCP configuration for every create
and resume launch, JSONL runtime-ID capture, durable-first steering, and
explicit degraded capabilities are implemented and scenario-tested with
virtualized runners plus a real local stdio MCP handshake. Claude receives an
ephemeral `--mcp-config`; Codex receives invocation-local `mcp_servers`
overrides, so TORCH does not rewrite either runtime's global configuration.
The exit gate remains open until an
owner-authorized live Claude/Codex acceptance run demonstrates coordination;
the automated suite intentionally incurs no provider usage.

### Stage 6: Self-hosting

- stable/candidate isolation;
- candidate fixture suite;
- atomic upgrade and rollback;
- TORCH's own approved roster and worktrees.

Candidate acceptance MUST run with a disposable HOME, TMPDIR, and XDG data,
config, cache, state, and runtime directories that are distinct from the active
installation/version store. The candidate gates MUST use this isolated
environment for test, lint, and syntax subprocesses, then remove it after they
finish. They MUST NOT inherit a user or candidate-install XDG data directory as
test state; doing so can make tests share or mutate the installation under
qualification. The acceptance receipt MUST include regression coverage for
this isolation boundary.

Exit gate: stable TORCH manages development, testing, and promotion of its
successor in local-only mode.

Implementation checkpoint (2026-09-27): isolated version installation,
reserved validation receipts, declared state compatibility, an atomic active
symlink, activation journaling, interruption reconciliation, exact rollback,
and approval-gated CLI operations are implemented and scenario-tested. The
candidate CLI requires named acceptance evidence, including the implemented
tracked backlog-through-integration lifecycle. The exit gate remains open
until an installed stable TORCH manages this source repository; candidate code
does not receive a hidden self-hosting exception.

### Stage 7: COMBATRIG re-import

- express COMBATRIG domains, prompts, resources, checks, schedules, and release
  boundaries through portable configuration;
- replace project-owned generic fleet scripts with installed TORCH operations;
- compare behavior against the current working fleet;
- retain COMBATRIG-specific gates and deployment as project adapters.

Exit gate: COMBATRIG operates without special-case orchestration in TORCH core.

Implementation checkpoint (2026-09-27): a read-only COMBATRIG importer now
maps the legacy dispatcher to the portable Session Manager and preserves the
observed area prompts and hashes, branch/worktree names, checks, scarce browser
capacity, schedule lifetimes, release authority, and backlog inventory. The
captured report at `reports/audit/combatrig-import-2026-09-27.json` found 33 areas
and 570 backlog records without modifying COMBATRIG. It remains intentionally
pending: 56 blocking ownership/exclusion gaps affect all 33 areas. The exit
gate remains open until those owner-reviewed boundaries are resolved and
COMBATRIG is safely installed and operated through portable TORCH.

The importer also provides an assessment-only backlog migration view. It MUST
report legacy-area counts and unmapped area IDs, preserve the distinction
between an area and a free-form `assignedTo` display name, and MUST NOT create
Torch tasks or infer a runtime identity. Legacy `done` is not sufficient to
mark a Torch item `completed`: the target state requires commit evidence and a
verifiable landed integration request. The view MUST identify manager-area
items and malformed or absent `observedAt` values without silently dropping
them. Backlog task creation and state transfer require a separate reviewed
migration; until then the original queue remains the source of truth.

### Stage 8: Product surface

- new public website and documentation;
- local Fleet Console;
- additional runtime and forge adapters;
- standalone distribution packaging.

Exit gate: the public surface accurately demonstrates behavior proven by the
released product.

Implementation checkpoint (2026-09-27): the Nostr-era landing page and
dashboard were removed. A new responsive public surface explains the
request-to-main flow through an interactive dispatch board, publishes the
current qualification ledger, and presents repository/spec-aware startup. A
separate loopback Fleet Console consumes the read-only observation service,
uses a restrictive content-security policy, and labels context locality as
unmeasured until evidence arrives. Local HTTP, desktop, and mobile rendering
are verified; public deployment and standalone distribution remain open.

## 29. Required acceptance configurations

### A. Laptop-only

```text
existing or new Git repository
no forge
Fleet-created local bare canonical repository
one laptop
Claude or Codex
```

The complete lifecycle from analysis through integration, restart, and detach
MUST pass.

### B. Existing local repository

Installation after project history exists MUST preserve all source history,
branches, untracked user files, and preexisting configuration. Uninstall MUST
restore the pre-install integration state.

### C. Forge-backed

An existing GitHub or equivalent remote MAY supply selected capabilities while
TORCH semantics remain authoritative.

### D. Local to forge-backed

Attaching a forge later MUST preserve worktrees, identities, backlog,
decisions, and messages.

### E. Forge-backed to local

Detaching the forge MUST leave local development operational.

### F. Forge outage

Local sessions, messages, commits, checks, backlog, and integration permitted
by policy MUST continue. Pending remote synchronization is visible.

### G. Mixed runtimes

At least two runtime adapters MUST exchange durable messages, query the same
roster, and coordinate one shared-boundary change.

### H. TORCH builds TORCH

An installed stable release MUST manage the next candidate using local-only
Git and TORCH's own control plane.

### I. COMBATRIG compatibility

The portable system MUST reproduce the essential COMBATRIG behavior without
hard-coded COMBATRIG paths or names.

## 30. COMBATRIG extraction map

The following files are behavioral references, not copy mandates:

| COMBATRIG surface | Portable TORCH responsibility |
| --- | --- |
| `tools/dev/fleet.sh` | lifecycle orchestration and first Claude adapter |
| `tools/dev/fleet-capture.mjs` | runtime-ID capture |
| `tools/dev/brief.mjs` | configuration-derived identity brief |
| `tools/dev/sessions.mjs` | presence and session registry |
| `tools/dev/doctor.mjs` | Git, worktree, session, resource, and risk diagnostics |
| `tools/dev/backlog.mjs` | durable work queue |
| `docs/agents/roster.json` | roster schema, scope, exclusions, and neighbors |
| `docs/agents/prompts/` | common plus domain prompt composition |
| `docs/DISPATCH.md` | Session Manager routing and reporting policy |
| `docs/WORKTREES.md` | isolation, process ownership, measurement, and resource rules |
| `docs/agents/OPERATIONS.md` | lifecycle, schedules, restart, and release separation |
| `docs/agents/WIND-DOWN.md` | coordinated shutdown |
| `docs/agents/RESUME-BRIEF.md` | durable restart handoff |
| `.claude/settings.json` | Claude-specific hook adapter |
| `tools/test/serve.mjs` | project-specific resource lease lessons |
| `tools/dev/release.sh` | project-specific release adapter example |

Extraction classification is mandatory:

**Portable core** includes roster semantics, briefing, worktree lifecycle,
backlog, doctor architecture, messaging, checks, integration, and resource
coordination.

**Runtime adapter** includes session creation, naming, resume, steering,
listing, stopping, ID capture, and lifecycle hooks.

**Project configuration or adapter** includes COMBATRIG domains, tests, port
allocation, GPU/browser policy, model assignments, secrets, deployment, asset
pipelines, and release schedule.

**Do not carry forward** includes duplicated prose configuration, hard-coded
home paths, COMBATRIG prefixes, implicit external cron state, or assumptions
that native Claude messaging is the Fleet API.

## 31. Open implementation decisions

These choices remain open but MUST be resolved through short architecture
decisions before their implementation stage:

1. SQLite schema and event-retention policy for machine-local state.
2. Control-plane transport: Unix socket, localhost HTTP, or a combination.
3. Exact project identity derivation and repository-move behavior.
4. Runtime process supervision across Linux, macOS, and Windows.
5. Configuration generation versus checked-in derived files.
6. Adapter capability negotiation and minimum conformance levels.
7. Check-input invalidation beyond Git commit identity.
8. Local canonical-remote naming when a project already has `origin`.
9. Multi-machine authentication and encryption.
10. Distribution and update signing.
11. Organization graph, configurable role authority, hierarchy change
    proposals, and safe promotion or reassignment of persistent identities.

None of these decisions may weaken the core invariants or make a forge
mandatory.

## 32. Definition of the first usable release

The first usable TORCH release is complete only when a user can run:

```bash
cd an-existing-project
torch init
torch analyze
torch install --runtime claude
torch up
```

review and approve a proposed organization, assign a real task through its
owner-facing coordination role, observe at least two domain managers
coordinate, record verification against exact commits, integrate through TORCH
policy, stop the fleet, resume it without losing identity or unfinished work,
and detach it without damaging the repository.

That lifecycle MUST pass with no Nostr relay, no GitHub account, no hosted CI,
no hosted database, and no project-local copy of the TORCH engine.
