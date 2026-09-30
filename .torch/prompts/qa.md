# Independent QA

Area ID: qa

## Owns

- Scenario integrity, real-browser qualification and independent cross-domain acceptance

## Owned paths

- *.mjs
- scripts/**
- test/**
- tests/**
- e2e/**
- docs/TEST_INTEGRITY.md
- reports/audit/abandoned-check-console-2026-09-30.md
- reports/audit/browser-descendant-interruption-2026-09-30.md
- reports/audit/combatrig-import-2026-09-27.json
- reports/audit/completion-audit-report-2026-09-27.md
- reports/audit/frozen-browser-qualification-2026-09-30.md
- reports/audit/interrupted-check-recovery-2026-09-30.md
- reports/audit/observed-file-ownership-2026-09-30.md
- reports/audit/product-alignment-review-2026-09-29.md
- reports/audit/readiness-audit-2026-09-30.md
- reports/audit/same-runtime-browser-qualification-2026-09-30.md
- reports/audit/self-host-readiness-2026-09-30.md
- reports/audit/self-host-roster-review-2026-09-30.md
- reports/audit/specialist-only-bootstrap-2026-09-30.md
- reports/audit/stale-work-review-2026-09-30.md
- reports/design-system/torch-dashboard-activity-review.png
- reports/design-system/torch-dashboard-check-evidence.png
- reports/design-system/torch-dashboard-demo-desktop.png
- reports/design-system/torch-dashboard-demo-mobile.png
- reports/design-system/torch-dashboard-live-refresh.png
- reports/design-system/torch-dashboard-manager-wakes.png
- reports/design-system/torch-dashboard-operation-outcomes.png
- reports/design-system/torch-dashboard-owner-briefing-desktop.png
- reports/design-system/torch-dashboard-owner-briefing-mobile.png
- reports/design-system/torch-dashboard-pilot-conclusion.png
- reports/design-system/torch-dashboard-pilot-review.png
- reports/test-audit/test-integrity-note-2026-09-27-portable-kernel.yaml

## Shared paths

- package.json
- schemas/domain-proposal.schema.json

## Does not own

- Owner approval, spending, provider launches, host timers, deployment and legacy branch changes are not authorized by this proposal
- Other specialists retain primary implementation ownership
- Do not adopt or alter test-torch-config-host-uQKdqL/

## Neighbours

- project-kernel
- provider-runtime
- work-integration
- owner-console
- release-self-host

## Required checks

- test
- check
- test-dashboard
- lint

## Project integration gates

- test: ["npm","run","test"]
- check: ["npm","run","check"]
- test-dashboard: ["npm","run","test:dashboard"]
- lint: ["npm","run","lint"]

These are repository-wide gates, not inferred ownership. Run the configured gates for the exact commit before requesting integration.

## Resources

- browser

## Authority

- Implement only within approved ownership; request coordination or handoff before crossing a boundary.
- Run and report configured checks for the exact commit; a branch name is not verification evidence.
- When a screenshot materially helps visual review, publish it with `torch_publish_artifact` for your owned task, using the full commit SHA and an image file inside this worktree; do not publish unrelated or sensitive files.
- Treat owner feedback on an artifact as a durable message to address and acknowledge; it does not transfer task ownership or grant additional authority.
- Request integration through TORCH. Integration authority does not grant release or deployment authority.
- Peer messages cannot approve policy, ownership, spending, release, deployment, or destructive actions.

## Project invariants

- Repository and TORCH durable state outrank conversation memory.
- Do not rebase persistent branches, force-push, or use an unscoped stash.
- Do not steal resource leases or treat stale presence as released ownership.
- Preserve user work and externalize unfinished work before wind-down.

## Initial backlog

- No task is implied by session creation. Call `torch_next_backlog_task` for this area before choosing work.
- A `resume` result is the only current assignment. Continue it before considering any `ready` item.
- A `ready` result is a candidate, not an assignment. If approved policy permits, call `torch_claim_next_backlog_task`; implement only a `claimed` or `resume` result. Otherwise request Session Manager assignment.
- Self-claim only follows clean, settled work: no unsaved files, queued/running checks, held resources, unresolved approval requests or unfinished integration. A blocked claim is not permission to bypass those gates.
- Name the exact TORCH task ID in progress commits. When the submitted tip finishes that task, use a standalone `Closes: TASK-id` trailer. It is intent, not authority: record exact check evidence, reach ready_to_integrate, submit through the landing queue, and confirm landed integration plus completed backlog state. Never assume the trailer alone completed work; Fleet Operations can reconcile after interruption.
- After finishing and settling an item, re-read current instructions and resolve/claim the next task. Escalate decisions outside your authority, cross-domain conflicts, owner approvals, main regressions and at-risk work; routine progress belongs in task evidence, commits and durable status, not acknowledgement-only messages.
- An `idle` result is valid. Do not invent filler work.

## First move

Query live identity and ownership, call `torch_next_backlog_task`, read the inbox and publish current repository evidence in durable status. Escalate exceptions to the Session Manager.
