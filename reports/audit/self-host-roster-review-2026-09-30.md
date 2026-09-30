# TORCH first self-host roster review — 2026-09-30

Status: proposed ownership map, not an approved or installable fleet proposal.
No provider, session, project install, stable activation or host timer is authorized
by this document. Existing source edits and legacy branches remain untouched.

## Why not install the deterministic baseline as-is

The previous intake proposed 14 specialists but left 14 components unassigned,
including CLI, control plane, Console, integration and self-hosting. Those omissions
include the tool's essential implementation. The baseline is evidence for design,
not approval of a complete organization. Broad source roots and small files do
not require one standing agent per directory.

A read-only file enumeration and unique-owner check covered **124 current files**
under `src`, `bin`, `site`, `schemas`, `scripts` and `test/fleet`, with zero missing
or duplicate primary mappings in the proposed grouping below. This is actual-file
coverage, not validation of a finalized domain-proposal JSON or its future globs.
New files require refreshed coverage and an explicit ownership decision.

## Six coherent specialist areas

| Area | Current primary implementation surfaces | Files | Integrated outcome |
| --- | --- | ---: | --- |
| Project kernel | `src/kernel/`, `src/design/`, `src/evolution/`, `src/control-plane/` | 19 | Analyze arbitrary projects, validate reviewed organization, install/reverse safely and preserve durable identity/authority |
| Provider runtime | `src/adapters/`, `src/runtime/`, `src/mcp/`, `src/schedules/`, `src/telemetry/` | 15 | Start/resume the selected local runtime with fresh instructions, durable communication and honest usage/wake limits |
| Work and integration | `src/backlog/`, `src/checks/`, `src/resources/`, `src/integration/`, `src/convergence/`, `src/canonical/`, `src/forge/`, `src/delivery/`, `src/importers/` | 15 | Move one verified exact-commit task through scarce resources and serialized landing without losing recovery evidence |
| Owner Console | `site/`, `src/console/`, `src/artifacts/`, `src/observability/` | 21 | Show the same real project state to the owner, preserve drafts, capture feedback and make consequential controls explicit |
| Release and self-host | `bin/`, `src/cli.mjs`, `src/self-host/`, `schemas/` | 4 | Package a commit-bound tool, expose usable commands and manage stable/candidate upgrade, rollback and removal |
| Independent QA | `test/fleet/`, `scripts/` | 50 | Own scenario integrity, real qualification harnesses and cross-domain acceptance evidence |

Remaining repository-level files are explicit shared boundaries rather than
forgotten components: package/lock metadata, `.gitignore`, README and distribution
configuration belong primarily to Release and Self-host; `eslint.config.mjs` and
test-integrity records to QA; architecture/specification documents to Project
Kernel; the roadmap/owner priorities to Fleet Operations. Evidence reports have
an originating author and QA custody, not their own development specialist.

The analyzer's `core` component is a root-file grouping (for example ESLint
configuration), not evidence that a legacy `core/` subsystem needs a new agent.
The `src` root component includes the CLI. Neither should silently remain ownerless.

## Shared boundaries and implementation authority

- One primary owner per implementation surface. Specialists can ask peers directly;
  a management layer must not become mandatory message routing.
- QA owns test integrity, while specialists propose/add regression scenarios with
  QA coordination. This is not permission to weaken tests or block ordinary peer work.
- CLI/schema/package changes need Release coordination plus affected service owners.
- Config, durable-state schema, MCP identity and organization changes need Project
  Kernel and Provider Runtime coordination before landing.
- Check/landing/resource/delivery policy is owned by Work and Integration; Console
  observes those authorities rather than inventing a second task/gate system.
- COMBATRIG importer changes do not authorize reading live private fleet state,
  cutting over COMBATRIG or modifying its repository.
- Protected `test-torch-config-host-uQKdqL/` is excluded from fleet adoption,
  checkpoint scope and trial cleanup. It is not a new specialist's work area.

## Coordination shape for the release trial

Define Fleet Operations separately from product sequencing. A proposed Program
Director is the owner-facing coordinator. Two outcome-owning domain leads can
exercise specification section 32 without claiming specialist implementation:

- Platform Lead: coordinate Project Kernel, Provider Runtime and Release/Self-host
  toward a portable installed/resumable tool.
- Workflow and Experience Lead: coordinate Work/Integration and Owner Console
  toward an observable verified task-to-landing loop.
- QA remains a horizontal independent service reporting operational findings to
  Fleet Operations and relevant leads, not another implementation manager.

These are proposed roles requiring review, not automatically created managers.
All areas may be defined while only a bounded subset runs. Do not launch six
specialists plus management simply because they are listed here. The trial should
activate only roles required for its approved task and coordinate the two leads
without duplicating code ownership. Other specialists remain idle or offline.

Codex defaults remain GPT-6-Luna/high; Claude defaults remain Sonnet. Per-session
provider/model overrides and mixed providers remain user choices. Automatic wakes,
daily reviews, self-claim and automatic landed closure should start disabled until
their specific trial policies are approved. No spending limit is implied by a
count-only wake budget.

## Order of operations

1. Review the exact accumulated source file scope; obtain owner direction for a
   local checkpoint. Preserve `main`, legacy branches and the protected fixture.
2. Commit only reviewed TORCH source/assets/tests/docs, no remote push. Re-run
   committed candidate acceptance; the dirty-source gate must not be bypassed.
3. Regenerate the repo/spec intake after the checkpoint. Convert this map into a
   fully validated pending proposal using paths/evidence available in that brief.
   Resolve any glob, shared-surface and organization-graph validation issues.
4. Owner reviews/approves the exact proposal, roster, runtime choices and installation
   plan. Build/install/activate the candidate without launching agents or host timers.
5. Separately obtain explicit provider budget/turn authority for the bounded live
   trial: real task, two leads coordinate, specialists verify exact commits, landing,
   stop/resume, preserved identity/work, detach and rollback.
6. Record evidence for specification section 32; source tests alone do not complete
   it. Default-branch promotion, remote publication, deploys and COMBATRIG cutover
   remain separate decisions.

Current stable status remains generation zero, no installed version or launcher.
Source qualification is green, but the rewrite is uncommitted and no live fleet
lifecycle has been qualified. This review does not claim completion.

## Pending JSON validation follow-up

The pre-checkpoint brief at
`/tmp/torch-selfhost-intake-20260930-0952.json` now has a corresponding
human-authored, pending Architect-contract proposal:
`/tmp/torch-selfhost-six-domain-proposal-20260930-1000.json`.
It preserves repository/specification bindings, discovered checks/resources/
schedules and the evidence graph. Six specialists consolidate source-component
paths, QA retains its baseline verification paths, and two proposed outcome-owning
leads have neither implementation paths nor owner-approval authority. Existing
cross-domain boundary observations are remapped rather than silently discarded.

`torch architect validate` reports valid, no problems, no unassigned analyzer
components, owner review required and no mutation. Proposal SHA-256:
`eb450375b197acb438e38f603f22b28466900dc807ae80feaadea4706622d326`.

This is semantic validation, not full-repository coverage, organization activation
or release approval. The analyzer permits the observed schema as a shared surface;
package/docs/schema primary ownership remains an explicit review boundary. Root
`*.mjs` and `src/*` component globs correspond to current ESLint and CLI evidence,
not permission to adopt unseen future files. Protected fixture observations remain
in the unchanged evidence graph but receive no owned/shared adoption paths.
Regenerate the proposal after an approved checkpoint; do not install this dirty-tree
artifact or interpret pending coordination roles as authorization to launch them.

## Bootstrap collision guard follow-up

The bootstrap validators previously accepted identical primary claims even though
later Fleet evolution rejected collisions. Both pending Architect validation and
approved-install validation now share a provable-primary-overlap check: identical
normalized patterns, `**`, and literal recursive parents such as `src/**` cannot
be owned by different specialists. Shared consultation remains allowed. The check
does not claim to solve arbitrary glob intersections. No owner approval or collision
coordination note overrides one-primary-owner semantics (specification section 12).

Twenty-two focused bootstrap/domain/lifecycle scenarios PASS, including a new
required acceptance marker. Focused ESLint and full isolated source acceptance
PASS; receipt: `/tmp/torch-bootstrap-ownership-20260930-acceptance.json`.

The source fix invalidated the earlier pre-checkpoint intake. Its refreshed pair
is `/tmp/torch-selfhost-intake-20260930-ownership.json` and
`/tmp/torch-selfhost-six-domain-proposal-20260930-ownership.json`, replacing the
09:52/10:00 artifacts for current review. Refreshed semantic validation is valid
with no problems or unassigned component findings; pending proposal digest:
`e093821ada37d09876deff95508f951c33eefebda3f7034562416d4cc3cf3ca0`.
No checkpoint, install, activation, provider invocation or host timer occurred.
