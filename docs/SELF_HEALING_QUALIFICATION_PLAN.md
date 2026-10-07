# Bounded self-healing qualification

Owner approved this priority on 2026-10-03. This extends the adaptive-company
plan and existing authoritative backlog; it is not a second work queue.

## Outcome

TORCH recovers authorized interrupted work without external babysitting. It
preserves unfinished work, assignments and evidence, never duplicates executors,
and escalates a genuine decision once with an actionable explanation. Managers
resolve coordination within delegated authority; deterministic machinery must
also detect manager/controller failure without relying on the failed agent.

## Execution order and existing owners

1. Provider Runtime / Kernel: finish `TASK-company-runtime-recovery`, including
   exact stopped-process proof, retained guard/controller-lock recovery, fresh
   instructions and preservation of dirty work. Qualification and native source
   adoption/integration remain prerequisites, not gates to bypass.
2. Release / Runtime / Kernel: finish `TASK-conversation-persistent-operations`;
   installer-owned services survive reboot, reconcile idempotently and uninstall
   only manifest-owned resources. Keep dormant-install and explicit activation.
3. Runtime / QA: prioritize the failure/backoff portion of
   `TASK-conversation-usage-governor`. Distinguish transient failure, quota,
   authentication, unavailable model, unknown outcome and owner pause. Circuit
   breakers must suppress repeated launches for the same unresolved cause.
4. Kernel / Work: complete the authority/event prerequisites and
   `TASK-company-reconciler`, with existing `TASK-conversation-event-driven-wakes`
   and `TASK-conversation-queue-watchdog`. Observe, reserve, recheck authority
   and revision, execute one bounded action, record and reconcile. No duplicate
   grant, event, task, messaging or recovery stores.
5. Manager / Console / QA: report the current wait owner, reason, age, last
   recovery attempt, next eligible action and exact evidence. Chase dependencies
   and approvals without inventing permission or sending repeated notices.

Urgent recovery does not preempt a running gate or steal an assignment. Managers
should resolve existing test/file-boundary handoffs and assign QA-owned tests
explicitly rather than circulate the same approval request indefinitely.

## Failure-injection acceptance matrix

Run against isolated fixtures and then an installed, owner-approved qualification
project. Do not intentionally kill the live development fleet to prove recovery.

| Fault | Required observable outcome |
| --- | --- |
| Specialist exits mid-task | Retain task/session/evidence and dirty bytes; prove old process stopped before one authorized resume |
| Process alive but quiet | Inspect tools/check queues and progress evidence; quiet alone never permits kill or guard release |
| Manager exits | Independent deterministic controller discovers the loss and performs one policy-authorized resume |
| Controller crashes after reservation | Reconcile exact invocation and durable reservation; no lost or duplicate execution |
| Crash leaves turn/controller lock | Recover only with exact ownership/process proof; unknown or foreign state fails closed |
| Reboot or service restart | Restore approved desired state once; preserve explicit manual pause and detached status |
| Missed/duplicate/out-of-order notification | Periodic reconciliation finds the wait; duplicates and stale revisions cannot repeat effects |
| Dependency or approval wait | Route to correct authority, record acknowledgement and escalate overdue wait without self-approval |
| Check/integration conflict | Preserve failed evidence and candidate; return actionable work to its owner without relaxing checks |
| Transient provider fault | Bounded retries with persisted backoff; no immediate unbounded restart loop |
| Quota/auth/model unavailable | Persist scoped hold/circuit breaker; report once, no paid fallback or unrelated-provider switch |
| Pause or authority revoked during recovery | Recheck immediately before effect and stop further launches |

Every accepted case needs exact candidate, controlled conditions, observable
assertions, original failure evidence and independent QA. Record recovery latency,
duplicate launches, lost work, retry count and owner interventions. A running
process, green command, task-state churn or acknowledgement is not itself useful
delivery. Finish with verified integration and next-work continuation.

## Current spending policy

The owner explicitly enabled unlimited automatic daily turns in alpha.4.2;
missing subscription telemetry must remain unknown, not become a false credit
estimate. Do not silently restore a finite cap as part of governor work. This
specific authorization supersedes older pilot cap instructions, not approval,
ownership, concurrency, no-progress or provider-failure boundaries. Unlimited
eligible work is not unlimited retries. No paid API fallback was authorized.

## Completion boundary

Do not close recovery/reconciler umbrellas from focused source tests alone.
Require installed-runtime failure injection, independent QA, reboot/pause
qualification and an observed unattended work cycle. Report remaining limitations
plainly; intentional owner decisions may remain blocked, forgotten handoffs may
not. No new permanent supervisor is required merely to implement this loop.
