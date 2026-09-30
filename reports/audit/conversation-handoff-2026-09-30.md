# TORCH conversation-to-fleet handoff

## Installed domains

The installed organization is appropriately scoped to this repository: one
Session Manager and six specialists. A current read-only ownership query over
129 tracked files under `src`, `bin`, `site`, `schemas`, `scripts` and `test`
found zero unowned files and zero duplicate primary owners. This claim does not
cover every historical report or future new directory.

| Domain | Responsibility | Effective Codex model |
| --- | --- | --- |
| Session Manager | Routing, ownership, priority and fleet health | GPT-6.1 Sol high |
| Project Kernel | Bootstrap, identity, canonical instructions and organization | GPT-5.6 Terra high |
| Provider Runtime | Harnesses, MCP, lifecycle, schedules and telemetry | GPT-5.6 Terra high |
| Work and Integration | Backlog, checks, resources, landing and recovery | GPT-5.6 Terra high |
| Owner Console | Dashboard, artifacts, feedback and observability | GPT-6 Luna high |
| Release and Self-host | CLI, package, candidates, upgrades and removal | GPT-6 Luna high |
| Independent QA | Scenario integrity and real qualification | GPT-5.6 Terra high |

The six-role grouping was a reviewed consolidation of repository evidence,
not a copy of COMBATRIG's specialists and not proof of a fully autonomous AI
Architect first-run. Proposed extra domain leads are inactive. Headcount alone
does not justify adding managers. Significant pipeline work may justify different
model effort or a new domain later, through the existing review path.

## Authoritative backlog

Owner-request intake created 34 proposed, unassigned items in the existing
Session Manager worktree backlog. There are 33 current follow-ups plus the
earlier narrower `automatic-scheduler` request, retained for manager triage
against the newer `persistent-operations` requirement rather than silently
deleted. All have acceptance criteria, affected domains and observed commit
binding; dependent slices reference existing task IDs. No assignment, provider
start, self-claim enabling or host service installation occurred.

Run `torch backlog list --json` from any registered checkout. The canonical
backlog service resolves the manager's tracked ledger; do not create a second
copy in the source checkout. Task IDs below are prefixed `TASK-conversation-`.

| Group | Task suffixes |
| --- | --- |
| First work / readiness | `first-work-intake`, `development-activation`, `selfhost-development-trial` |
| Persistent operations | `persistent-operations`, `automatic-scheduler`, `event-driven-wakes`, `queue-watchdog`, `nightly-main-tests`, `usage-governor`, `idle-worktree-refresh`, `queue-planning`, `project-services` |
| Provider reliability | `runtime-diagnostics`, `startup-preflight`, `mcp-isolation`, `update-startpaths`, `mixed-provider-qualification` |
| Pipelines | `pipeline-definitions`, `pipeline-provenance`, `pipeline-flow`, `pipeline-stalls`, `pipeline-console`, `pipeline-metrics`, `pipeline-pilot` |
| Live qualification | `hierarchy-pilot`, `scheduler-qualification`, `browser-portability`, `landing-closure`, `closure-revert-review`, `delivery-qualification` |
| Owner/product/release | `owner-digest`, `console-workflow`, `documentation-current`, `release-qualification` |

## What is not yet automatic

Setup and retained-state restore have been qualified; installed alpha.2 is
healthy. All agents remain offline. The current manager schedule declares a
15-minute interval, but no TORCH-owned systemd units are installed or active.
Read-only host timer enumeration confirmed no TORCH timer; unrelated Archive
timers were untouched. The owner's latest request is that init/install provision
these integrations automatically. That is now an explicit target in specification
section 22 and the backlog, not an already delivered feature.

The shared common prompt still authorizes only an installation smoke test and
the project self-claim policy is disabled. Starting agents under it does not
authorize development. The manager should read and triage proposed work, recommend
a first bounded slice and budget, and obtain the development/startup approval
before delegation. New installs should offer reviewed TODO import or ask the
owner what they want first; repeated intake must deduplicate rather than queue
every historical checkbox.

## Suggested first implementation sequence

1. First-work intake and persistent operations planning/provisioning: make
   the product's installation genuinely complete while stopped until ready.
2. Runtime diagnostics and exact launch preflight: make startup failures legible.
3. Separately approved bounded self-host development, landing/closure and
   scheduler qualification, followed by persistent event/watchdog/nightly work.
4. Pipeline definitions, immutable provenance, checked transitions and Console.
5. Finish mixed-provider, organization-growth and release qualification.

There is no authorization here to promote the rewrite to default `main`, deploy
the public website, send notifications, alter COMBATRIG, spend on asset generation
or install active recurring AI wakes. Those boundaries remain in the task criteria.

## Validation

Installed `torch backlog list` sees all 34 items. Acceptance criteria and domains
are populated; every dependency exists and the dependency graph is acyclic.
Installed `torch backlog health` reports healthy with no anomalous assignments.
Its bounded historical activity coverage remains incomplete, correctly labelled
unknown rather than proof of inactivity. Existing backlog/scheduling regression
suite: 23/23 PASS. All seven identities remain offline. These are backlog/spec
changes, not implementation of the newly requested onboarding or automation.
