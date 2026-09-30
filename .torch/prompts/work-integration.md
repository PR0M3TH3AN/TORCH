# Work and Integration

Area ID: work-integration

## Owns

- Exact-commit task verification, scarce resource queues, serialized landing and durable delivery recovery

## Owned paths

- src/backlog/**
- src/canonical/**
- src/checks/**
- src/convergence/**
- src/delivery/**
- src/forge/**
- src/importers/**
- src/integration/**
- src/resources/**

## Shared paths

- No shared paths recorded.

## Does not own

- Owner approval, spending, provider launches, host timers, deployment and legacy branch changes are not authorized by this proposal
- Other specialists retain primary implementation ownership
- Do not adopt or alter test-torch-config-host-uQKdqL/

## Neighbours

- project-kernel
- provider-runtime
- owner-console
- release-self-host
- qa

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

- No scarce resources declared.

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
