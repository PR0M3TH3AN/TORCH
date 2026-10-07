# Adaptive software company: integration plan

Status: owner-approved roadmap direction, 2026-10-01; implementation pending.
Applies to the Portable Agent Fleet. This document records the supplied adaptive
software company proposal and the agreed refinements. It does not certify the
current alpha as unattended or production-ready. The fleet remains manually
paused until the owner explicitly requests resume.

## Product boundary

TORCH supplies organization, ownership, intent, authority, durable work,
coordination, evidence, verification, integration and recovery. Coding harnesses
supply implementation intelligence, tools and temporary delegation. Start with
the smallest useful organization; do not require a fixed Engineering/Product/QA
taxonomy or a new permanent AI supervisor. Projects may use different roles.

Preserve worktree isolation, one active implementation assignment per specialist,
revision-checked mutations, direct peer communication, resource leases, exact
candidate verification, serialized integration, independent review where required,
audits and separate release/deployment authority. KB/handbook/working-memory
requirements remain governed by [Project knowledge](PROJECT_KNOWLEDGE_SPEC.md).

## Existing work: extend, do not replace

This is a staged extension of current systems, not a rewrite. Reuse the current
identity, organization, backlog, messaging, runtime, checks, resource, integration,
delivery and schedule services. Owner-approved grants are already proposed as
`TASK-874ed1e4-9414-4a8f-8575-a6c5aceefc56`; do not build a competing grant system.
Link first-work intake, event-driven wakes, usage governor, hierarchy pilots,
starting-presence and provider update-path tasks instead of duplicating them.

The earlier executor-outcome task is completed, but later pilot launches exposed
stdout-bound/terminal-outcome disagreement. A completed historical task is not
proof that the later installed runtime is ready for unattended operation.
Preserve those receipts and qualify the new regression explicitly.

## Phase A: trustworthy runtime state before unattended coordination

Lead domains: Provider Runtime, with Project Kernel and independent QA.

1. Reproduce the installed output-bound failure using bounded deterministic
   fixtures. Keep parser/transport bounds; do not treat a wrapper's observation
   as a substitute for an authenticated runtime outcome.
2. Define startup reservation, process/session ownership, terminal outcome and
   recovery contracts. Distinguish success, failure, unknown and physically stopped.
3. Publish guarded starting presence before launching. Coordinate manual,
   scheduled and controller paths through the same exclusivity mechanism.
4. Add a supported, owner-attributed recovery operation with executor-stopped
   evidence, revision/lease checks and audit. Never impersonate a specialist,
   edit SQLite manually, infer death from a name or drop an unknown reservation.
5. Qualify manual pause across reboot, quota reset, schedule due, message arrival,
   upgrade and event replay. Only explicit owner resume can clear this pause.

Exit gate: oversized output, timeout, signal, malformed terminal data and a crash
between spawn and receipt cannot produce false success or a duplicate launch;
unknown outcomes remain recoverable and block unsafe actions. Actual installed
runtime qualification and independent QA are required, not just fixture tests.

## Phase B: scoped capability authority migration

Lead: Project Kernel; extend the existing owner-grants proposal.

Identity identifies the participant; role describes responsibility; an approved
grant confers authority. Reporting edges and implementation ownership do not
confer management capabilities. Never interpret delegated user authority as
permission to impersonate the owner or act outside its explicit scope.

Before coding, inventory identity-special business rules and their CLI, MCP,
Console, scheduled and internal entry points. Define a single authorization
service and a capability mapping for each action. Grant records must identify:

- grant ID, issuer/delegation provenance, recipient and required capability;
- project/domain/task/path scope and operation constraints;
- approval/reference evidence and policy/grant revision;
- validity/revocation and whether further delegation is allowed;
- owner-reserved exclusions and independent-review conflict rules.

Initially migrate the current Session Manager's permitted operations without
widening permissions. Support preview and explicit approval of broader grants.
No default wildcard capabilities, hierarchy inheritance or self-granting.
Evaluate the current grant immediately before effects; audit the actual actor,
grant, scope, relevant revisions and allow/deny reason.

Exit gate: old permitted actions still work under equivalent grants; ungranted,
out-of-scope, revoked and stale actions fail across every entry point. A new lead
can be assigned a bounded capability without source changes. Independent review
cannot approve its own work merely because it also holds a leadership role.

## Phase C: durable event contract

Lead: Work & Integration, with Kernel/Runtime; extend existing event-driven wakes.

Version events for work-ready/blocked, assignment completion, verification,
integration readiness, approval requests/decisions, pending messages, resource
release, runtime observations, schedule due and evidence-backed organization
pressure. Existing audit records are evidence, not automatically executable orders.

Each event needs an ID, project, type/schema version, source entity and revision,
actor/cause, timestamp, correlation/causation IDs and deduplication key. Keep
payloads bounded and avoid credentials, private document bodies or full transcripts.

Define emission and recovery at each state-change boundary. Use transactional
outbox semantics where one store supports them; when Git/files and SQLite cross
a boundary, specify a durable journal/reconciliation protocol rather than claiming
one atomic transaction. Preserve one authority for task state. Define cursor,
retention, replay and schema-upgrade behavior before enabling consumers.

Exit gate: crash before/after state mutation or event delivery, duplicate delivery,
out-of-order delivery and replay cannot lose a significant transition or authorize
a stale action. Event delivery may be at-least-once; effects must be idempotent.

## Phase D: small desired-state reconciler

Lead: Work & Integration / Provider Runtime. No strategy or implementation logic.

For each supported action, observe authoritative current state, compare with
approved policy and desired work, evaluate eligibility, reserve one bounded action,
recheck revisions/authority/pause/budget, execute and record the outcome.
Eligibility is allow, deny or unknown; unknown is not permission to retry.

Begin with durable notices and read-only explanations. Then pilot wake of one
eligible identity for assigned work, followed by narrowly configured ready-work
self-claim and integration-authority notifications. Do not automatically approve,
land, release, deploy, reassign ownership or create identities just because an
event arrived. Preserve existing checks and authorization gates for each operation.

Require persisted pause/backoff, launch reservations, concurrency limits,
bounded retry rules, actionable failures and periodic safety reconciliation.
Queue/backend/usage/model/auth unavailability must not create busy model loops.
Check budgets before launching, including uncertainty in subscription usage.
Use minimum useful wake context; a timer is a safety net, not another AI supervisor.

Exit gate: duplicate events cannot duplicate execution; paused or uncertain work
is never restarted; missed events are found by reconciliation; stale observations
cannot override a newly revoked grant. Start with an owner-approved bounded pilot,
manual intervention metric and immediate pause/rollback path.

## Phase E: native execution capabilities and repository evidence

Runtime lead: Provider Runtime. Repository evidence lead: Project Kernel.

Keep execution capabilities separate from lifecycle functions. Describe native
subagents/delegation, browser/computer use, artifacts, worktrees, background tasks,
checkpoints and review as advertised, locally available, qualified, unavailable
or unknown. Bind qualification to executable/version, host, account/config and
evidence; declarations alone do not prove availability. No model calls merely
to populate the inventory without approval.

Temporary harness workers are accountable to the persistent TORCH specialist,
not new roster members. They must not acquire broader TORCH credentials, authority,
ownership or uncontrolled resource access. Keep delegation provenance and aggregate
available cost evidence. Coordinate native worktrees with TORCH-owned workspaces.
Native review is useful but not automatically independent QA. Avoid orchestration
squared and promote workers only through evidence-backed organizational proposals.

Extend deterministic reconnaissance with bounded workspace/build/module graphs,
CODEOWNERS, co-change observations, entry points, schemas, deployment/process
boundaries and recurring cross-domain tasks. Give the Architect provenance,
coverage and uncertainty, not invented semantic conclusions. Do not execute
untrusted build tools or fetch history merely to analyze a repository silently.

Exit gate: absent capabilities have honest fallbacks; helper delegation cannot
expand authority; organization proposals cite real evidence and remain advisory.

## Phase F: owner-oriented onboarding and evidence UX

Leads: Owner Console, Release/Self-host and Kernel. Extend first-work intake.

Offer one guided path through prerequisites/runtime qualification, analysis,
small-team proposal and rationale, ownership/check gaps, explicit review,
installation/worktree preview, first-work intake and optional startup. Preserve
advanced CLI and diagnostics. Do not redefine the existing read-only `init` into
a mutating command without a documented compatibility decision and tests.

"Company ready" must distinguish configured, launchable and actually operational.
Missing models/auth, unknown outcomes, unresolved ownership and unqualified checks
must remain visible. Separate consent for downloads, spending, persistent services,
agent startup and publication; onboarding cannot override a manual pause.

Show conclusions, reason, evidence and exact artifacts progressively, with stable
links to commits, check conditions, receipts, decisions and discussions. Derive
implemented/verified/independently reviewed/integrated/released/live states from
their actual authorities. Surface unknown coverage and rejected/relaxed criteria;
green exit alone does not support a claimed business outcome or performance number.

Exit gate: a fresh user can reach useful reviewed work without knowing SQLite,
runtime IDs or schedule unit internals; desktop/mobile/keyboard browser inspection
passes. Every important asserted status can be traced to exact evidence.

## Phase G: adaptive organization and storage investigation

Extend existing evolution/hierarchy pilots to evidence-backed contraction,
promotion and consolidation. Roles must justify recurring outcomes rather than
headcount. Record baseline/window, hypothesis, costs, success/stop criteria and
owner-reviewed pilot. Transfer authority, ownership, docs and unfinished work
safely; never retire an active/dirty/unknown worker. Keep one implementation owner.

Measure bookkeeping friction before changing storage: dirty manager time,
administrative commits, collisions, checkpoint effort and integration delay
attributable to state. Compare current tracked records, dedicated state branch
and Git-intent/SQLite-operations alternatives against offline recovery, export,
backup and migration requirements. Do not dual-write authoritative task state or
move it until a separate reviewed decision and recovery tests justify the change.

## Phase H: multi-project and release qualification

Use separate controlled fixtures/pilots for a small web app, monorepo, compiled
systems project, graphics/game project and optional docs/data-heavy project.
Record init-to-useful-team, request-to-assignment, verified integration latency,
owner interventions, coordination volume, launch failures, false greens and
measured/estimated usage separately. Evaluate organization changes for actual benefit.
Do not run expensive/live-provider experiments without owner-approved budgets.

Release gates include migrations/backup compatibility, crash-safe lock recovery,
model/auth preflight, repository relocation, provider update compatibility,
distribution provenance/signing decision, atomic upgrade/rollback, event replay
and platform-specific schedule qualification. Remote execution is optional and
needs a separate trust/deployment boundary, not an implicit requirement.

## Integration and rollback discipline

- Assign bounded slices through the existing backlog; agree shared contracts first.
- Add scenario-based fault and authority tests with Test Integrity Notes. Do not
  weaken accepted scenarios or substitute simulated success for installed evidence.
- Land exact checked commits through the existing integration mechanism, not
  concurrent direct pushes or a second queue. Keep runtime/parser/security work
  independently qualified from marketing and UI changes.
- Ship additive, disabled-by-default policy/config first. Migrations need explicit
  version/compatibility rules, backup/restore tests and an upgrade preview.
- Do not roll back a database by blindly activating old code. Define supported
  data downgrade or fail closed while preserving the new store and receipts.
- Enable notifications before wakes; qualify one-domain pilot before broad fleet
  activation. Fresh source is not automatically an installed runtime upgrade.
- Give the owner a report of configured/enabled/qualified state and remaining gates.

## Backlog index

The authoritative proposals use `TASK-company-` IDs: runtime-recovery,
authority-migration, event-contract, reconciler, native-capabilities,
repository-evidence, onboarding, evidence-ux, organization-experiments,
storage-study and multi-project-qualification. Existing tasks remain authoritative
for their previously scoped work. New proposals are unassigned until Manager
triage after explicit owner resume; this document is not another work queue.
