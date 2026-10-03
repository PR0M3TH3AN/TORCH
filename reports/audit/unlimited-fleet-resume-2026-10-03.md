# Owner-authorized unlimited fleet resume

The owner explicitly requested removing the daily limit and continuing against
subscription access. Installed alpha.4.2 source is committed at
`df8e557685a5dbf4a27f5f03098ecb4495615527` on
`release/selfhost-alpha4-20261003`. Functional source is not canonically integrated.

Real installed-candidate acceptance: 294 PASS, zero failures/cancellations,
four explicit skips. Accepted digest:
`8ffed308d89a696ac3b62ce6568fe23a0920c7221e0b651f2a0cec7de1231477`.
The unlimited scenario first failed against capped code, then passed; an added
physical-guard check initially used the wrong API signature and was corrected
without dropping assertions. Failed intermediate acceptance was not activated.

Installed isolated smoke passed fresh install, unlimited CLI, read-only brief,
pause preserving policy, restoring a finite cap before rollback, and unchanged
project configuration. Zero providers were launched by smoke tests.
Evidence: `/tmp/torch-alpha42-installed-smoke-result.json`.

## Live state

Activated alpha.4.2 through the accepted-version service. Set owner-audited
`maxTurnsPerDay: null`, cleared the obsolete same-day override and retained all
charged attempts. Concurrency remains seven. Sent durable resume/priority
instructions to all seven standing identities, including an independent QA
request for this incremental change; that request is not a completed review.

Started the existing continuation service and refreshed only the owned console.
At 2026-10-03T20:11:01Z the installed live snapshot verified all seven identities
with active process-backed working guards: Session Manager, Project Kernel,
Provider Runtime, Work and Integration, Owner Console, Release and Self-host,
Independent QA. Attempt count was 103, with no daily stop reason.
Snapshot: `/tmp/torch-alpha42-live-snapshot.json`.

Dashboard remains `http://127.0.0.1:4174/console`. Its continuation label now says
the daily limit is disabled instead of displaying a null/fake allowance.

## Boundaries

Unlimited mode persists until the owner changes it; it is not a credit meter.
No paid API fallback, model/profile change or bypass of approvals, ownership,
verification, physical executor guards or stalled-work holds was enabled.
Provider quota/auth failures remain failures, not permission to route elsewhere.
The manager was instructed to avoid retry storms and prioritize unblockers.

Before rolling back to alpha.4.1 or older, restore a finite cap with the current
runtime; those versions correctly reject the new null policy. This prevents an
old runtime from silently interpreting unlimited as an ordinary allowance.
Canonical integration, native sandbox brief follow-up and broader release
qualification remain pending. Active execution alone is not proof of landed work.
