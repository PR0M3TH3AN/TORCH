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

One human owner primarily works through one Session Manager. The Session
Manager routes work to persistent domain managers. Each domain manager has a
stable identity, explicit ownership, a dedicated Git branch and worktree,
known neighboring domains, required verification, and durable restart state.
TORCH supplies the control plane that lets these sessions coordinate across
different agent runtimes without making any one runtime the definition of the
fleet.

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
6. provide one primary Session Manager conversation for the human owner;
7. support direct peer coordination without removing Session Manager
   authority over priority and ownership;
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
    one general session to repeatedly evict and reload unrelated project areas.

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
5. The Session Manager controls routing, priority, and ownership rulings.
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

## 6. Terminology

**Owner**

The human authority for the project. The owner approves the organization,
high-impact policy, deployments, destructive actions, and other decisions
reserved by project configuration.

**Fleet**

The complete TORCH-managed organization for one project.

**Session Manager**

The persistent dispatcher session that receives owner requests, routes work,
establishes ownership and ordering, monitors fleet health, and reports useful
decisions or risks to the owner.

**Domain manager**

A persistent specialist assigned to an architectural concern or operational
responsibility. A domain manager is staff; temporary subagents are helpers.

**Runtime**

The agent harness used to host a session, such as Claude Code, Codex, or
OpenCode.

**Runtime adapter**

The implementation that maps TORCH session operations to one runtime.

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
        ┌───────▼──────┐ ┌──────▼───────┐  ...
        │Claude adapter│ │ Codex adapter │
        └──────────────┘ └──────────────┘
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

### 9.1 Read-only initialization

`torch init` MUST begin read-only. It identifies the repository, validates Git,
detects existing TORCH state, identifies the canonical branch and remotes, and
reports what analysis would inspect.

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

A directory alone is not sufficient justification. Domains such as
"programming" are too broad; domains such as "button colors" are normally too
narrow. Small projects may need four domains. Large projects may need twenty
or more. TORCH MUST not target a predetermined fleet size.

Cross-cutting roles such as QA, performance, security, release, architecture,
documentation, design direction, migration, or operations are created only
when repository evidence and project goals justify them.

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
authority; or reject the analysis.

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
  start_last: true
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

### 12.1 Session Manager

The Session Manager normally does not implement product features. It:

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

### 12.3 Temporary subagents

A domain manager MAY use runtime-native subagents for bounded research,
inspection, testing, or review. Temporary subagents do not receive persistent
Fleet ownership unless promoted through an approved roster change.

## 13. Control plane and MCP contract

The control plane MUST provide provider-independent operations for:

- identity;
- roster and domain discovery;
- ownership by path or capability;
- presence and session status;
- durable messages and acknowledgements;
- coordination requests and handoffs;
- status, completion, and blocker reports;
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
OpenCode and other runtimes follow the same contract.

A single Fleet MAY mix runtimes and models by domain. Git provider choice and
AI runtime choice are independent.

## 15. Session lifecycle

### 15.1 Fresh start

`torch up --fresh` creates new runtime conversations while preserving Fleet
identities. It combines the common prompt, domain prompt, current approved
configuration, and initial resume instructions. Runtime IDs are captured as
soon as they are available.

The Session Manager starts last so workers and the control plane exist before
dispatch begins.

### 15.2 Resume

Normal `torch up` resumes known runtime sessions when safe. If a conversation
cannot be resumed, TORCH creates a replacement runtime session for the same
Fleet identity and supplies durable state. Loss of a conversation MUST NOT
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

## 16. Git and worktree policy

### 16.1 Isolation

The main checkout remains on the canonical branch and SHOULD not be used for
domain implementation. A domain session works only in its assigned worktree.

TORCH MUST inspect process ownership and working directory before stopping a
process. Parentage alone does not establish ownership.

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
criteria, evidence, and current commit when applicable.

Owner decisions affecting future work MUST be recorded durably. Chat messages
alone are insufficient. Project source, tests, approved configuration, and
accepted decision records outrank summaries and generated prompts.

Implementation checkpoint (2026-09-27): backlog items are revisioned JSON
records in the Session Manager's tracked worktree. The service and equivalent
CLI/MCP operations enforce transition, owner, dependency, and concurrent-write
rules; publish assignments and blockers through durable messaging; surface
active work in doctor; and require a landed integration record at the same
commit before completion. Keeping management records in the manager worktree
prevents backlog activity from dirtying canonical main.

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
backlog, check, resource, integration, schedule, and audit state without
initializing a missing database. Context-locality output explicitly reports
`unavailable` until runtime usage samples exist, preventing estimates from
masquerading as measurements.

Identity-bound context telemetry now accepts provider measurements or explicit
estimates, never an unlabeled mixture. It records cached and uncached input,
cache creation and reads, compactions, resumed prompt size, micro-USD cost,
task/commit references, and verified item counts. Reports keep evidence classes
separate, derive cache-read ratio and cost per verified item, and warn when
usage has no verified outcome.

## 22. Scheduling

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
Cron definitions currently require an external launcher; persistent timer
installation remains open and will use the normal ownership manifest.

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

## 25. Security and trust boundaries

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
planning, identity-bound MCP configuration plans, JSONL runtime-ID capture,
durable-first steering, and explicit degraded capabilities are implemented and
scenario-tested with virtualized runners. The exit gate remains open until an
owner-authorized live Claude/Codex acceptance run demonstrates coordination;
the automated suite intentionally incurs no provider usage.

### Stage 6: Self-hosting

- stable/candidate isolation;
- candidate fixture suite;
- atomic upgrade and rollback;
- TORCH's own approved roster and worktrees.

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
captured report at `reports/combatrig-import-2026-09-27.json` found 33 areas
and 570 backlog records without modifying COMBATRIG. It remains intentionally
pending: 56 blocking ownership/exclusion gaps affect all 33 areas. The exit
gate remains open until those owner-reviewed boundaries are resolved and
COMBATRIG is safely installed and operated through portable TORCH.

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

review and approve a proposed organization, assign a real task through one
Session Manager, observe at least two domain managers coordinate, record
verification against exact commits, integrate through TORCH policy, stop the
fleet, resume it without losing identity or unfinished work, and detach it
without damaging the repository.

That lifecycle MUST pass with no Nostr relay, no GitHub account, no hosted CI,
no hosted database, and no project-local copy of the TORCH engine.
