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
- safe coexistence with pre-existing `.torch/` content, with Git-ignore
  trackability checks and ownership-exact reversal;
- XDG-local runtime state;
- installation ownership manifest;
- read-only health diagnostics covering installation integrity, runtime
  availability, worktree drift count and age, Git operations, and honest
  recoverability grade;
- conservative, explicitly confirmed purge that validates the exact local
  state path and distinguishes owned history from live sessions, locks,
  leases, guards, landing, persistent launchers, and unknown files;
- reversible ordinary uninstall that winds down the Fleet, safely removes
  owned persistent schedule launchers, and preserves organization and history;
- reviewed worktree plans with branch/path collision protection;
- isolated branches and worktrees with locally ignored task markers;
- purge protection for dirty and uniquely committed domain work.
- SQLite-backed stable Fleet identities and presence;
- durable direct/group messages with per-recipient acknowledgement;
- revision-checked tracked backlog tasks with dependencies, evidence, and landed-commit completion;
- live ownership, neighbours, handoff, coordination, completion, and blocker operations;
- equivalent CLI and identity-bound MCP surfaces;
- current MCP stdio interoperability through the official protocol SDK;
- explicit-capability Claude, Codex, and Pi adapters with per-identity
  model/reasoning selection;
- identity-bound MCP registration for Claude/Codex and a bundled Pi extension
  that exposes the same TORCH tool set through Pi's extension API;
- invocation-scoped runtime configuration without changing the user's global
  provider settings;
- durable-first Codex steering with native `queue` notification when available;
- worker-first/Session-Manager-last fresh start and resume planning;
- safe wind-down that refuses active work, Git operations, leases, check or
  measurement guards, and in-flight landing, then records final worker status
  plus local and tracked resume state.
- shell-free configured checks with exact-commit receipts;
- transactional FIFO resource queues and leases;
- a native integration queue with durable authorization and fast-forward main protection;
- domain-owned convergence plans that defer during checks, measurements, pins, dirty work, and Git operations;
- a local bare canonical Git option with honest one-disk/local-remote grading;
- a durable delivery state machine that keeps implemented, verified,
  integrated, release-ready, released, deployed, and live-verified distinct,
  with per-state authority and provider-capability gates;
- mutation audit events tied to project and Fleet identity.
- isolated candidate version stores with explicit compatibility declarations;
- acceptance-gated atomic activation, crash reconciliation, and exact rollback.
- a read-only COMBATRIG compatibility importer that preserves legacy prompts,
  branch/worktree mappings, checks, resources, schedules, release boundaries,
  and backlog inventory while refusing to invent missing ownership boundaries.
- a redesigned public product site and local Fleet Console backed by the same
  repository and runtime state rather than a separate dashboard model, with a
  read-only observation surface and narrowly scoped, preview-confirmed owner
  actions for feedback, task proposals, next-launch profiles, and schedule-timer
  setup/refresh;
  the Console covers ownership, domain relationships, hierarchy-derived
  startup/wind-down order and blockers, worktree drift, recoverability,
  acknowledgements, checks, integration, delivery, resources, schedules,
  decisions, provider health, and context evidence. Owners can save
  project-scoped browser views over the existing backlog without creating a
  second queue or changing task state.
- identity-bound context-usage telemetry that separates measurements from
  estimates and relates cost/cache behavior to verified work;
- validated system/session schedules with shell-free actions, authority,
  retries, durable run evidence, and explicit approval for mutation;
- an owner-approved user-systemd launcher for system schedules, bound to the
  exact tracked configuration digest and recorded for exact reversal.
- durable Fleet evolution: the Session Manager can propose a justified new
  persistent domain after a read-only assessment of recurring backlog,
  handoff, and coordination signals, while owner approval gates the configuration commit,
  identity, prompt, branch, and worktree activation; it can also propose safe
  retirement when coordination cost exceeds continuing value, preserving the
  branch and refusing live, dirty, guarded, leased, or active work. Evidence-
  backed merge and split proposals are durable and owner-gated, but approval
  deliberately cannot rewrite ownership: TORCH reports the separate migration
  proof still required for backlog, branches, prompts, worktrees, and neighbours.

Live mixed-provider qualification, stable self-host bootstrapping, COMBATRIG
cutover, installation of the implemented system-schedule launcher on this
machine, and public deployment remain staged work.

The canonical architecture and delivery plan is
[docs/PORTABLE_AGENT_FLEET_SPEC.md](docs/PORTABLE_AGENT_FLEET_SPEC.md).
Resolved implementation choices and deliberately gated boundaries are recorded
in [docs/ARCHITECTURE_DECISIONS.md](docs/ARCHITECTURE_DECISIONS.md).

## Development

`torch digest build` prints an owner-first Markdown report; add `--json` for
structured data. It uses a rolling UTC window (24 hours by default), distinguishes
landing from receipt-reported deployment/live verification, and puts pending
owner approvals and unresolved delivery operations first. It reports blocked
work, completed items, recorded approval decisions and neglected owner requests.
Missing sources, truncated results and incomplete Git history are explicit;
unstructured decision documents are not claimed as recent decisions.

`torch digest publish --by owner --yes` stores a local report. `torch digest
latest --json` and the local console's read-only `/api/digest` return the latest
published report; console snapshots include it too. Automatic publication can
be enabled in approved config with `owner_digest: { enabled: true,
window_hours: 24, max_items: 30 }` and a system coordination schedule whose
action is `{ type: "owner-digest" }`, required authority is `owner`, and retry
limit is one. Choose cadence through the existing schedule trigger; no timer
is installed by this setting. This deterministic action wakes no AI and sends
nothing externally. The dashboard's Briefing view displays the saved report,
with publication time, evidence coverage and a link to current approvals. The
same renderer works in the isolated dashboard demo. Unpublished, stale and
unknown evidence stays explicit; published reports are not silently rewritten
when live approvals change. External notifications remain pending; all reports
are local/private by default.

Delivery adapters now retain durable operation and attempt records, including
failures. Inspect `torch delivery operations --json` and `torch delivery attempts
--id <delivery-id> --json`; local console snapshots include bounded recent
records. Approved `delivery.retry.max_attempts` is 1–5 (default 1). Automatic
retry requires the adapter to declare `retrySafety[operation]` as `idempotent`
or `read-only`, plus a structured failed receipt reporting
`failure: { classification: "transient", effects: "not-applied" }`.
Permanent failures, missing safety and uncertain effects never auto-retry.
Attempts share one operation idempotency key; adapters must actually honor it.
Policy changes stop further attempts. Existing high-impact approvals still apply.

Thrown/malformed responses and interrupted executions remain unresolved and
block another caller. After independent provider inspection confirms no effect,
the owner can use `torch delivery recover-not-applied --operation <id> --by
owner --runtime-stopped --evidence <reference> --yes`. This is explicitly
owner-attested, not sensor proof: it neither executes an adapter nor advances
delivery state, and retains original uncertain attempts. Do not use it for an
operation that actually succeeded. Instead preview `torch delivery
recover-succeeded --operation <id> --by owner --dry-run --json`, then confirm
with `--runtime-stopped --evidence <provider-proof> --yes`. This reconciles a
saved successful receipt without invoking an adapter, checks exact state,
unchanged destination settings and current owner authority, and applies once.
It also handles a saved success receipt whose parent operation flag was not
updated. Legacy records without destination hashes require the full original
policy hash. Provider receipt truth and stopped-executor confirmation still
need live qualification. Real provider/CLI adapter loading remains development
work; configuring a provider name alone does not install an adapter.

Requirements:

- Node.js 22 or later
- Git

### Provider version preflight

Opt in during installation with `torch install ... --update-runtimes --yes`,
or on an existing project with `torch runtimes update-policy --mode auto --yes`.
Approved `torch up --yes` (including resume) refreshes the selected built-in
providers against the official npm `latest` release, at most once every 24
hours. Change the interval with `--max-age-hours 1` through `168`; disable future
downloads with `--mode off`. Dry runs never query the registry or install code.
Existing projects stay opt-in; `--yes` alone does not authorize new downloads.

Preview or force a manual update:

```bash
torch runtimes update --runtime codex,claude,pi --dry-run --json
torch runtimes update --runtime codex,claude,pi --force --yes --json
```

Updates install exact resolved versions into XDG-local TORCH-owned prefixes,
verify `--version` and `--help`, then atomically select their absolute executable
paths. Global installations, login files and provider settings are untouched;
old versions remain available to already-running processes. Codex and Claude
packages can execute installation scripts; Pi uses its current official
`@earendil-works/pi-coding-agent` distribution with scripts disabled. Custom
adapters require their own reviewed updater. Concurrent updates stop at a lock;
failed downloads or verification retain the prior selection and block automatic
startup rather than silently claiming the latest version. Interrupted updates
leave the lock for inspection, not automatic deletion. Model/account access and
adapter flag compatibility remain separate live qualification gates. Persistent
schedule and hierarchy-start updater integration remains pending; use `torch up`
for this first trial.

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
remains the deterministic baseline and fallback. Architect proposals must also
justify a flat fleet or evidence-backed coordination roles, spell out integrated
outcomes and authority boundaries, and preserve direct specialist communication;
they remain advisory until separate owner review and approval.

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
node bin/torch.mjs install --proposal fleet-proposal.json --runtime codex --dry-run --json
node bin/torch.mjs install --proposal fleet-proposal.json --runtime codex --yes --json
node bin/torch.mjs doctor --json
node bin/torch.mjs worktrees --dry-run --json
node bin/torch.mjs worktrees --yes --json
node bin/torch.mjs up --fresh --dry-run --json
```

Starting or stopping configured runtime sessions is always a separate explicit
step:

```bash
node bin/torch.mjs up --fresh --yes --json
node bin/torch.mjs up --only backend,qa --dry-run --json
node bin/torch.mjs list --json
node bin/torch.mjs brief --area backend --json
node bin/torch.mjs capture --json
node bin/torch.mjs down --dry-run --json
node bin/torch.mjs down --yes --json
node bin/torch.mjs detach --dry-run --json
node bin/torch.mjs detach --yes --json
```

`capture` externalizes the current stable identities, runtime IDs, presence,
worktree commits, open integration, guards, and leases without stopping
sessions. `down` and `detach` refuse active work, Git operations, unreleased
leases, active checks or measurements, and in-flight landing. Each worker sends
the Session Manager a durable final status, and the manager stops last after
writing both the local snapshot and tracked `.torch/RESUME-BRIEF.md`. `detach`
then marks runtime integration detached while preserving the tracked
organization, local state, branches, and worktrees. A later explicit `up`
reattaches the selected runtime sessions.

The Fleet can evolve when recurring work develops a coherent new boundary.
The Session Manager is instructed to run a read-only evolution assessment at
startup, after backlog intake, and when repeated handoffs appear. The
assessment surfaces conservative recurring-boundary signals without creating
anything; the manager must inspect the repository and judge whether a durable
session would actually improve context locality or ownership. It may then
propose the domain through MCP or the CLI, but cannot approve or activate it.
Owner approval and activation are deliberately separate, and runtime startup
remains another explicit step:

```bash
torch fleet assess --from session-manager --json
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

The manager can also submit evidence-backed boundary changes:

```bash
torch fleet propose-merge --from session-manager --proposal merge.json --json
torch fleet propose-split --from session-manager --proposal split.json --json
torch fleet reject --change <change-id> --by <owner> --reason "Not yet" --yes --json
```

Every existing owned-path pattern must be assigned exactly once. Approval
records the owner's decision but does not activate a merge or split: TORCH
returns a migration-required blocker until backlog, prompts, worktrees,
branches, neighbours, and ownership transfer have a separately proven plan.

The CLI fallback exposes `agents`, `who-owns`, `message`, `inbox`, `ack`,
`status`, `complete`, `blocked`, `coordinate`, `handoff`, and the tracked
`backlog` lifecycle. MCP hosts launch
`torch-mcp --root /path/to/repository --area <fleet-id>` and receive the same
service operations, identity-bound to that Fleet area.

Local verification and convergence use `torch checks`, `torch resources`, and
`torch integrate`. A project without a forge can preview and create its bare
canonical store with `torch canonical plan` and `torch canonical create --yes`.

Specialists can claim their next routed task without a manager round trip when
the owner enables `backlog.self_claim` in approved project configuration:

```json
{ "backlog": { "self_claim": { "enabled": true, "areas": ["frontend"] } } }
```

This policy is disabled by default. Review `torch backlog claim-next --area
frontend --dry-run --json`, then use the same command with `--yes` to claim.
The bound MCP equivalents are `torch_plan_backlog_claim` and
`torch_claim_next_backlog_task`. Existing assignments resume first; new claims
select explicitly routed ready work in priority/FIFO order and refuse dirty
worktrees, pending checks, held/waiting resources, unresolved approvals or
unfinished integration. Completion and landing authority are unchanged.

Inspect commit-linked progress with `torch backlog activity --json` (or MCP
`torch_backlog_activity`). Approved `backlog.activity` configuration can set
`stale_days` (default 3) and `max_commits` (default 1000). The bounded scan reads
local canonical and managed worktree branches, prioritizes owner requests, and
reports coverage gaps as unknown rather than declaring work neglected. Mention
the exact TORCH task ID in progress commits. Metadata edits do not reset this
activity clock. Commit dates and messages are reported Git metadata, not proof
of meaningful work. Standalone `Closes: TASK-id` lines record intent only;
automatic landed completion is disabled by default. Enable approved
`backlog.activity.auto_close_after_landing: true` to reconcile trailers from
the exact submitted tip after a successful landing. Only tasks already
`ready_to_integrate`, owned by the source specialist, naming that exact commit
and carrying evidence qualify; current required checks and canonical ancestry
are rechecked. Unknown or mismatched tasks stay open. A closure failure leaves
the successful landing intact and reports `needs-review`.

For crash/lock recovery, Fleet Operations can preview `torch backlog
close-landed --integration <id> --area session-manager --dry-run --json`, then
confirm with `--yes`. Replaying completion does not create another transition.
MCP offers `torch_plan_landed_task_closure` and `torch_reconcile_landed_tasks`;
the latter requires `approved: true`. This does not grant deployment authority.

Long-waiting checks can opt into frozen inputs. In the approved check definition,
set `snapshot.paths` to explicit relative inputs (for example `dist` and the
test harness) and `snapshot.source_commit_file` to a captured build marker
containing the full source SHA. Keep generated build outputs Git-ignored and
write that marker during the build. Then, from a clean specialist worktree:

```bash
torch checks prepare --id browser-test --area frontend --yes --json
# Save the returned prepared ID before requesting a browser slot.
torch resources acquire --id browser --area frontend --json
# Once acquired, use the frozen subject rather than the live build directory:
torch checks run-prepared --prepared <returned-id> --area frontend --yes --json
torch resources release --id browser --area frontend --json
```

Use `checks prepared` to inspect durable prepared/running/finished records, or
`checks cancel-prepared --prepared <id> --area frontend --yes` to remove an
unstarted owned copy. Resource release/cancellation remains explicit and is
not implied by cancelling a check. Copies use reflinks or independent copies,
never hardlinks. The specialist can keep rebuilding after preparation; receipts
identify the captured SHA, not its newer worktree tip. Checks must read their
captured working directory, not absolute live paths or an unrelated server.
Interrupted running checks are retained for inspection, not silently rerun.

Checks can also declare conditions that must hold before measurements:

```json
{
  "conditions": {
    "command": "node",
    "args": ["tools/report-test-conditions.mjs"],
    "timeout_seconds": 30,
    "required": [
      { "id": "clock-moving", "equals": true },
      { "id": "visible", "equals": true },
      { "id": "invincible", "equals": false }
    ]
  }
}
```

Your probe reports `schema: "torch.dev/check-conditions/v1alpha1"`,
`subject: { commit, inputDigest }` (digest required for frozen inputs), and
`conditions: { "clock-moving": true, "visible": true, "invincible": false }`.
It must inspect the tested runtime, not echo expected values. TORCH supplies
the expected SHA/digest in `TORCH_CHECK_COMMIT`/`TORCH_CHECK_INPUT_DIGEST` to the
probe. Include the probe and its dependencies in frozen input paths.

Missing/mismatched preflight conditions stop measurements. Invalid postflight
conditions invalidate otherwise green measurements. Receipts retain both
reports and a diagnostic line preceding measurement output. Conditions are
project-reported evidence; your harness must inspect the same runtime and
detect drift during measurements. Projects choose their own conditions.

The dashboard expands check receipts to show recorded frozen-input commit/digest,
copy strategy, invalidation reasons and before/after condition observations.
Prepared checks appear alongside receipts; a running record is labeled completion
unconfirmed, never assumed live or automatically restarted. Legacy receipts
explicitly show missing condition evidence. The view is read-only and bounded to
the latest 40 receipts/preparations; private capture paths are not displayed.

Integration and release also shows recorded canonical fetches and delivery
attempts. Unknown effects and interrupted running records require review; adapter
success is not independent proof that a release is live. The view does not offer
automatic retry/recovery, and raw receipt references/error text stay out of it.

The dashboard refreshes every 15 seconds while visible; Pause updates stops
automatic reads. Edited/focused forms and active previews keep their DOM while
unrelated panels update. Retained panels are explicitly marked potentially older;
server-side approval/revision checks still apply. Manual refresh also preserves
drafts, and completing an action releases only its own form. Failed reads keep
the existing evidence and report the failure. Polling never wakes an AI agent.

The work board's Activity review shows stale owner requests first, separately
from tasks whose progress is unknown because managed Git history is incomplete.
Blocked items retain waiting context. This uses named commits, not metadata edits
or uncommitted work, and never changes backlog state. Daily automatic stale-work
review and live installed-fleet qualification remain open.

An equivalent Git remote can later become the optional canonical forge without
changing TORCH identity or coordination semantics:

```bash
torch forge plan --remote origin --json
torch forge attach --remote origin --provider generic-git --yes --json
torch forge status --json
torch forge sync plan --json
torch forge fetch plan --json
torch forge fetch --yes --attempts 3 --json
torch forge fetch status --json
torch forge sync --yes --json
torch forge detach --dry-run --json
torch forge detach --yes --json
```

Attach requires the selected remote's main ref to equal local canonical main
exactly and never pushes or fetches implicitly. Integration lands locally
through TORCH's serialized FIFO queue; it does not publish as a side effect.
After reviewing the read-only sync plan, the owner may explicitly publish the
landed canonical commit. Sync is fast-forward-only, never force-pushes, and
blocks if the remote is ahead or has diverged; it does not fetch or merge
implicitly. During a forge outage, status and doctor expose pending
synchronization while local identities, messages, checks, backlog, worktrees,
and policy remain operational. Detach works during that outage and restores
the prior local canonical configuration; it does not delete a user-owned
remote.

Delivery is separate from integration. A clean domain tip starts as
implemented; exact-commit checks gate verification, and a landed integration
record gates integration. Release, deployment, and live verification require
owner authority, explicit approval, and successful adapter receipts. Fresh
installs configure no delivery providers, so TORCH cannot publish or deploy by
accident:

```bash
torch delivery create --area backend --label "API change" \
  --evidence "task:TASK-42" --json
torch delivery plan --delivery <id> --to verified --by backend --json
torch delivery transition --delivery <id> --to verified --by backend \
  --evidence "check:<receipt-id>" --json
torch delivery configure --release-provider <adapter> \
  --deployment-provider <adapter> --dry-run --json
torch delivery configure --release-provider <adapter> \
  --deployment-provider <adapter> --yes --json
torch delivery transition --delivery <id> --to released --by owner \
  --evidence "artifact:<reference>" --yes --json
```

Adapter names configure policy; a trusted installed adapter must also declare
and implement the requested capability. The stock CLI ships with no release or
deployment provider, so configuration alone cannot trigger an external action.

TORCH source checkouts can stage a self-host candidate without changing the
active version. Candidate build runs the complete local acceptance, lint, and
syntax gates before writing its receipt. Git checkout staging is bound to a
clean exact commit, copies tracked source plus its local dependency tree,
excludes unrelated untracked files, and refuses escaping symbolic links:
Activation maintains an installation-owned stable `torch` launcher pointing
through the atomic active-version link; it refuses an unrelated existing path.

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

The npm artifact bundles TORCH's pinned production dependencies. The package
distribution gate installs that tarball offline in a clean consumer without
depending on a previously warmed machine-level npm cache.

Persistent domain sessions also create a context-locality opportunity: each
specialist can keep its relevant working set hot instead of one general session
reloading unrelated project areas. TORCH treats cache/token savings as a
measurement hypothesis until provider usage and verified task outcomes prove it.

This is still an alpha. Claude, Codex, and Pi launch plans are scenario-tested;
the Pi extension's full TORCH MCP tool bridge is exercised against a local
fixture, and an installed-Pi offline/no-session startup smoke test verifies
the bundled extension loads without a provider turn. Pi's `typebox` package is
declared as a TORCH runtime dependency because the extension API requires its
schema type. The tests make no paid provider calls. A live mixed-provider,
multi-domain acceptance run remains an explicit owner-authorized qualification
gate.

Manager check-in schedules can wake configured agents with a shared daily
invocation limit. For subscription/local runtimes, explicitly set
`action.wake` to `{"enabled":true,"budget_mode":"invocation-count"}` and set
`runtime_wake_budget.max_invocations_per_day` on the project. This limits wake
invocations, not dollar spending. For a runtime that supports enforced spending
limits, use `budget_mode: "usd-hard-cap"` with `max_usd_per_invocation`; built-in
adapters currently reject that mode. Wakes remain disabled by default and
timer installation is separate. Pi requires your chosen provider/model.

Hierarchy pilots retain their baseline and success/stop criteria. The Session
Manager can record a comparison with `torch fleet hierarchy-review-pilot
--proposal <id> --review <json-path> --from session-manager --yes`; inspect
the durable history with `torch fleet hierarchy-pilot-reviews --proposal <id>`.
The review JSON supplies `summary`, `recommendation` (`adopt`, `adjust`,
`reverse`, or `inconclusive`), `metrics` (name, value, unit, classification and
evidence), and `success`/`stop` assessments (criterion, outcome and evidence).
Cover every baseline metric and criterion exactly once. Classifications are
`measured`, `qualitative`, or `unavailable`; outcomes are `met`, `not-met`, or
`unknown`. Evidence is reviewer-reported, not independently verified. An
adoption recommendation needs a complete pilot window and reported measured
success; it does not adopt the organization or start any agent.

To conclude a pilot, review `torch fleet hierarchy-conclusion-plan --proposal
<id> --decision adopt --reason "<owner decision>"`, then confirm with
`torch fleet hierarchy-conclude` using the same arguments plus
`--plan-hash <reviewed digest> --by owner --yes`. Use `--decision reverse` to
restore prior reporting relationships at a new revision. Reversal preserves
implementation owners, sessions, worktrees and backlog work; obsolete manager
schedules remain for explicit review. Neither action starts/stops agents or
changes systemd. A changed plan must be reviewed again.
The Console offers the same preview/confirm conclusion workflow beside a
piloting hierarchy proposal. It shows blockers and exact work/graph/schedule
impact; an unsupported adoption plan cannot be confirmed.

Inspect uncertain manager launches with `torch schedules wakes --json`.
An interrupted reservation remains locked until the owner independently checks
and stops the runtime, confirms the manager is offline, and runs
`torch schedules recover-wake --reservation <id> --runtime-stopped --note
"<inspection evidence>" --yes`. This records your attestation, not automatic
proof of termination. It never launches an agent, acknowledges a message,
refunds the daily budget, or permits replay of that check-in. Review/handle
the old inbox message before a fresh check-in can wake the manager.

Run the redesigned public surface and local operational console on loopback:

```bash
npm run site:serve -- --repo /path/to/project --port 4317
```

The landing page's **View dashboard demo** link opens `/console.html?demo=1`:
the actual Console using an isolated sample project. Its actions stay in the
browser tab. Explore tasks, approvals, agent requests, image feedback, and
runtime profile changes; **Reset demo** restores the sample project.
`npm run test:dashboard` verifies these workflows in Chromium (install
Playwright's Chromium browser for this developer check).

Generated roles inherit the selected installation runtime. For a mixed fleet,
use `--runtime codex,claude,pi --default-runtime codex`; explicit per-role
assignments are preserved. Codex inherits `gpt-6-luna` with high reasoning;
Claude inherits `sonnet`. Installation dry-runs show the resolved default.

The public explanation is at `/`; `/console` does not repair or silently alter
Fleet state. Its backlog filters and saved named views are browser-local
preferences scoped to the project identity; they do not change task data.
Optional feature and milestone labels stay on authoritative backlog tasks; the
Console groups those tasks for progress visibility without inferring labels or
treating progress as test, integration, or release evidence. The snapshot API
remains read-only. The Console's narrowly scoped write actions include owner
feedback, priority/task proposals, per-identity next-launch profiles, and
schedule-timer installation or refresh. Each consequential change has a fresh
preview and separate confirmation. New tasks stay proposed and unassigned
until the Session Manager triages them. Timer review lists every affected
system schedule and clearly states that enabling the timer may dispatch due
work; the snapshot only verifies TORCH-owned unit files and their config
digest, not live systemd state. Profile changes never reconfigure running
sessions or start a runtime.
Automation can obtain the read-only observation with:

```bash
node bin/torch.mjs console snapshot --repo /path/to/project --json
```

Agent sessions can publish task-bound screenshots into private project state;
the local gallery checks their stored digest when serving them:

```bash
torch artifacts publish --area frontend --task TASK-123 --title "Settings page" \
  --alt "Settings page at narrow width" --file screenshots/settings-mobile.png \
  --commit "$(git rev-parse HEAD)" --json
torch artifacts list --json
```

Owner feedback first prints a target/effect preview. Add `--yes` only after
reviewing it; confirmation routes one durable message to the responsible
identity. The local Console also offers a narrowly scoped feedback form with a
same-origin, single-use preview/confirm step. Its snapshot endpoint remains
read-only; feedback does not change task status or grant other Fleet authority:

```bash
torch artifacts comment --artifact <artifact-id> --body "Keep the compact header" --by owner --json
torch artifacts comment --artifact <artifact-id> --body "Keep the compact header" --by owner --yes --json
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

Mutating schedules additionally require `--yes`. TORCH can preview, install,
inspect, and exactly remove its user-systemd launcher, but never installs the
persistent timer implicitly:

```bash
torch schedules launcher plan --json
torch schedules launcher install --yes --json
torch schedules launcher status --json
torch schedules launcher remove --yes --json
```

Automatic FIFO integration is opt-in. A project may add this JSON object to the
`schedules` array in `.torch/torch.yaml` after reviewing its exact effect (the
file currently uses JSON syntax despite its `.yaml` suffix):

```json
{
  "id": "integration-drain",
  "title": "Drain individually authorized integration requests",
  "owner": "owner",
  "lifetime": "system",
  "trigger": { "type": "interval", "seconds": 60 },
  "behavior": "mutating",
  "action": {
    "type": "integration-drain",
    "landing_authority_id": "session-manager",
    "limit": 20
  },
  "required_authority": ["owner"],
  "retry": { "max_attempts": 1 },
  "source_of_truth": "owner-reviewed integration policy"
}
```

This periodic action uses the same serialized FIFO drain as
`torch integrate drain`. It cannot converge branches, push to a remote, relax
exact-commit checks, or start an AI runtime. Each request still needs a passing
check receipt on its exact source commit and separate authorization from the
configured landing authority. Installing the system timer is a standing owner
approval for the listed system schedules to run; an authorized change may land
on the next tick without another owner prompt. Defining the schedule alone does
not install or start that timer. Inspect `torch schedules list --actor owner`
and `torch schedules launcher plan` before installation. The timer dispatches
all due system schedules, not just integration.

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

### Changing an agent's AI profile

New Codex identities default to `gpt-6-luna` with high reasoning effort; new
Claude identities default to `sonnet`. After installation, edit `.torch/torch.yaml`
to change `runtimes.codex.model` / `runtimes.codex.reasoning` or
`runtimes.claude.model`. Set `model` and/or `reasoning` on
`session_manager` or a specific entry in `domains` to override just that
identity. These are project-local settings; TORCH does not rewrite global
Codex or Claude configuration, and changing a profile does not launch agents.
You can also inspect or change one installed identity from the CLI:

```sh
torch profile show --area session-manager
torch profile set --area session-manager --runtime codex --model gpt-6-luna --reasoning high --yes
torch profile defaults --runtime codex --model gpt-6-luna --reasoning high --yes
torch profile set --area session-manager --reset --yes
```

`profile set` requires `--yes`, validates the resulting project config, and only
changes future launch plans; it does not start, stop, or reconfigure a running
session. `--reasoning none` clears the identity's reasoning override (or the
runtime default's explicit value), falling back to the runtime's built-in
behavior. `--reset` clears an identity's model/reasoning overrides while
keeping its selected runtime. Use `profile defaults` to change or reset the
project-wide defaults for one runtime; identity-specific values continue to
take precedence.
For Pi, choose a model explicitly using Pi's `provider/model` identifier; TORCH
does not infer a provider or account. Pi sessions run one resumable turn at a
time, save transcripts under private project state, and start the TORCH MCP
server only while a TORCH tool call is executing.

Other local runtimes can be added as explicit adapter plugins. A trust preview
prints the exact module hash without executing the module; confirm only after
reviewing that path and digest:

```sh
torch runtimes list
torch runtimes trust --name my-agent --module /absolute/path/my-agent.cjs --json
torch runtimes trust --name my-agent --module /absolute/path/my-agent.cjs \
  --yes --sha256 <hash-from-preview>
torch profile set --area documentation --runtime my-agent \
  --model provider/model --yes
```

The user-local allowlist lives outside the repository in
`$XDG_CONFIG_HOME/torch/runtime-adapters.json` (or `~/.config/torch/`). Plugins
must export `createTorchRuntimeAdapter({ env })` from a canonical absolute
`.cjs` entrypoint and satisfy TORCH's declared lifecycle contract. Project
configuration can select a trusted adapter but cannot grant trust or choose a
module path. The exact entrypoint SHA-256 is checked before each registry load;
the trusted module and its imported dependencies run with the current user's OS
permissions, and the digest pins the entrypoint only. `torch runtimes list`,
`torch doctor`, and `torch profile show` inspect trust/profile metadata without
loading plugins. Install/start/profile-change operations load the selected
trusted plugin to validate or plan that adapter, including a dry-run that uses
it. Revoking trust does not stop a session already running in that process.

## License

MIT
