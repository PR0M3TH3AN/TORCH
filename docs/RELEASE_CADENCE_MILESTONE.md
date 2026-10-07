# Qualified scheduled releases and self-host upgrades

Status: owner-approved development milestone, 2026-10-07; not live-qualified.
Authoritative work: `TASK-conversation-project-services`, dependent on
`TASK-conversation-persistent-operations`. Extend existing schedules, delivery,
verification, integration and version services; do not create a parallel queue.

## Outcome

Continuously integrate eligible tested work through the serialized landing queue.
At an approved release window, freeze one eligible integrated commit, build and
qualify its exact package, and report ready, skipped, blocked or failed with
evidence. A deadline never forces unfinished work into a release or weakens gates.

TORCH's own initial cadence is 08:00 and 16:00 in `America/New_York`, equivalent
to `0 8,16 * * *` interpreted in that named timezone. This is a project-specific
choice, not a hard-coded default for every repository. Current development uses
`rewrite/portable-agent-fleet`; this milestone does not itself move work to main,
deploy to production, activate a candidate, or install an unqualified scheduler.

## Two distinct operations

1. **Scheduled release preparation:** resolve the approved canonical target,
   freeze its exact eligible SHA and package identity, execute required gates and
   independent review, then publish an auditable readiness result. If no eligible
   change exists or qualification fails, skip rather than reuse stale evidence.
2. **Deployment or self-host activation:** execute only under separately recorded,
   destination/version-specific authority. For TORCH managing itself, wind down
   and capture the existing fleet, verify no incompatible active writers, upgrade
   in place, validate state and the Console, then resume authorized work. Preserve
   native session identities, assignments, history, evidence and rollback ability.

Normal cadence prepares releases. Automatic deployment/activation is optional,
requires an explicit reviewed policy and cannot be inferred from enabling a cron.
The first upgrade milestone need not finish the whole backlog: it requires the
necessary compatibility fixes plus exact-package independent qualification.

## Dashboard configuration

Provide a focused Release schedule editor within the existing release/schedule
surface, not another long Overview section or a separate scheduling system:

- Presets: twice daily, daily, weekly and custom cron; allow manual-only/disabled.
- Editable five-field cron and explicit IANA timezone. Initial TORCH preset:
  `0 8,16 * * *`, `America/New_York`.
- Show a plain-language interpretation and the next several run times before save.
  Validate cron and timezone on the server, not merely in browser controls.
- Show enabled policy separately from observed scheduler installation/liveness,
  last attempt, actual candidate/version, result, accountable blocker and next run.
- Explain the selected operation: prepare, deploy or self-host upgrade. Do not
  suggest that a preparation-only schedule will ship or upgrade automatically.
- Save through existing actor authorization, revision-checked mutation and audit;
  detect concurrent edits. Changing time or enabling preparation grants no release,
  deployment, credential, runtime-launch or activation authority.
- Support safe pause/resume and a no-effects preview. Missed runs, DST and machine
  sleep behavior must be explicit; do not unleash an unbounded catch-up batch.
- Keep cards compact; show exact receipts, failures and schedule details on demand.

Reuse existing schedule definitions and launcher reconciliation. If the installed
schema lacks timezone or typed release preparation, extend that boundary with
compatible migrations rather than storing another cron string in a UI-only file.
Installation/init should present the proposed schedule for owner review; never
silently enable deployment or resume an intentionally paused fleet.

## Execution sequence and responsibilities

1. Session Manager promotes and assigns an eligible slice of the existing task,
   records this milestone, and preserves active primary ownership/dependencies.
2. Release/Self-host defines exact-candidate readiness and package/upgrade gates;
   Work/Integration supplies the existing serialized canonical readiness boundary.
3. Provider Runtime supplies durable scheduling, timezone semantics, bounded
   invocation/recovery and launcher reconciliation under existing ownership.
4. Owner Console implements the authorized configuration and outcomes surface.
5. Independent QA qualifies the behavior and exact first release package.
6. Present the first qualified upgrade and its checkpoint/rollback plan to the
   owner. Enable the reviewed cadence only after its installed qualification.

No specialist must abandon an existing primary assignment to start this milestone.
Reliability unblockers and owner Chat remain priorities. Post-launch feedback
requirements remain deferred. COMBATRIG is reference behavior, not an integration
or credential/deployment provider that TORCH may assume.

## Acceptance and qualification

- Scheduled windows select only integrated eligible work; pending/conflicting or
  failing branches remain excluded. Required exact-SHA/artifact receipts and
  independent review cannot be borrowed from an older candidate.
- A bad package, missing authority or no new eligible work yields an actionable
  skipped/blocked/failed result; the last approved installed/live version remains.
- Concurrent timer/manual triggers and retries cannot produce duplicate effects.
  Unknown delivery outcomes remain held until supported reconciliation, not retried
  as though failure were proven. Budget/manual pause/resource gates remain intact.
- Fresh installation, upgrade of an existing project, interrupted activation and
  rollback qualify against the exact distributable package and real state layout.
  Source-only tests do not establish installed compatibility.
- Invalid cron/timezone, unauthorized edit, stale revision and operation escalation
  are refused without effects. Authorized edits persist and reconcile correctly.
- Next-run previews and actual execution agree across DST, clock changes, reboot,
  sleep and missed windows; repeated wall-clock minutes do not duplicate releases.
- Durable user-unit definitions survive stopping/reboot where supported; missing
  units or failed launchers appear as unhealthy, not merely policy-enabled.
- Self-host upgrades checkpoint active work and maintain resumability and rollback;
  they do not hot-swap an incompatible runtime under active agent/database writers.
- Console preview/edit/history and ready/skipped/blocked/failed details are exercised
  in the actual browser. The UI never labels a release ready solely from exit zero.

This document is requirements and assignment guidance, not evidence that any of
these capabilities have been installed, released or independently accepted.
