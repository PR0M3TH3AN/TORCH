# Fleet arbiter checkpoint — 2026-10-03, 05:58 UTC

## Outcome

The owner-approved blocker-clearing directive produced concrete component
commits and exact QA contributor consent. No new verified fleet landing has
been established in this checkpoint. Automatic usage reached the approved
48-turn cap; no additional provider turns were started or budget increased.

## Decisions and evidence

- Work committed its read-only convergence component at
  `7e0734ae90314b6182046b1d813efd40b453743f`.
- Release committed read-only CLI routing at
  `dd77b7015e5d34851725237d6f424babccf7f7d4`.
- QA message `c3f7ac15-5d40-4f85-a27b-6d5837b141a9` approved the exact
  compact-card source/test contribution. Actual browser capability remains
  unavailable in those native sessions; this is not visual acceptance.
- Arbiter directive `8865db38-a077-4935-a154-7b566d65aa44` authorized
  source-only isolated composition without managed-branch convergence or
  integration. Corresponding directives were persisted for all implementers.

## Concrete compatibility failure

A detached checkout at canonical
`7e3d333c5467c15d72be950f1fac9c3cd5439aee` was created at
`/tmp/torch-readonly-composition-EirOji/candidate`. Applying exactly Kernel
`18ccb0890d93c8a01e2c2d96db775b1ec14fe973` with `cherry-pick -x` produced
content conflicts in `src/control-plane/service.mjs`. Composition stopped;
Work and Release components were not applied, and no composed test PASS is
claimed. The conflicted detached checkout is retained as diagnostic evidence.
Canonical and managed agent checkouts were not altered by this operation.

The conflicts expose future schema-v3/reservation prerequisites absent from
canonical, which initializes schema version 2. The reader requires
`runtime_launch_reservations`, and its branch-local refusal scenario treats
version 2 as incompatible. Pulling the entire future branch would therefore
broaden this narrow current-branch unblock into an architecture upgrade.

The existing Kernel reader tests passed 2/2 on the Kernel branch under hermetic
fixtures (`/tmp/torch-reader-component-review-20261003.log`). This is source
review evidence only: it does not establish canonical compatibility, composed
CLI behavior, operational receipts, independent QA, or installed qualification.

## Next bounded action

Kernel should supply a current-canonical-compatible reader slice without
future reservation APIs, schema migration or live writer initialization. QA
must approve strict version-relative refusal scenarios, not weaken assertions.
Immutable SQLite observation also needs a demonstrated consistent snapshot or
fail-closed behavior under concurrent writers, not only a sidecar precheck.
Correction request `34a90b11-a64d-4ed7-a7ae-cf2ba8ef46f2` and corresponding
manager/peer requests preserve the exact evidence and composition boundary.

## Controller handoff

The old three-slot controller drained without termination. At 05:57:52 UTC,
the replacement seven-slot worker ran, obtained the released controller lock,
and returned `daily-turn-cap` with `launched: []`. This verifies a cap-preserving
handoff, not seven concurrent native workers or reboot persistence. The
replacement timer remains configured; the ledger was not reset.

## Remaining gates

Current-base compatible composition, strict composed CLI scenarios, exact
source gates, independent QA, guarded serialized integration and next-work
continuation remain open. Native execution cannot continue today without an
explicit new budget decision; the existing policy resets its daily allowance
at UTC midnight. No deployment, installed-runtime upgrade, live DDL, authority
expansion or completion assertion follows from this checkpoint.

## Subsequent verification and delivery blockers

The sections above describe the earlier checkpoint, not the latest outcome.
Canonical source subsequently reached `3bb9c55`; the installed accepted runtime
was not upgraded by the following source reviews.

### Current-v2 reader and CLI

The corrected Kernel slice `c79f8d4`, Work convergence slice `7e0734a`, and
Release CLI slice `dd77b70` applied cleanly to canonical `3bb9c55` in the
detached review tree `/tmp/torch-current-reader-review-vFjsSi/candidate`.
The resulting candidate was `62629b806b00b4ceb8701c754c65b22738614eb9`.
Root's full suite passed 282 tests with four explicit skips. A focused command
named nonexistent `cli.test.mjs`; its 11 passing tests therefore did not prove
CLI coverage. The actual full-suite glob did include `cli-scenarios.test.mjs`.

Root then removed the reader's `BEGIN` and transaction-open flag in an isolated
mutant. The original four reader scenarios still passed: a demonstrated
coverage gap, not proof of a production-reader defect. QA granted an additive
correlated-generation scenario, delivered as
`85914d3ef8a310878cec8345d976e78b3128d47e` atop `62629b8`.
Root independently verified five reader scenarios passing on that exact
candidate. The same no-transaction mutant failed the new scenario because a
single reader combined generation A and generation B, not because close failed.
Evidence was delivered to QA and Manager in owner messages `23102515` and
`fd088d9f`. The review-only mutant remains in
`/tmp/torch-reader-oracle-independent-W4arvj/candidate`; do not promote it.

Work separately delivered `cdc3aa9b800f7f2c1c925e1d8ecd21d9948fd3d2`, a sibling
of `85914d3` atop `62629b8`. Its additive CLI scenario invokes actual `brief`,
`converge plan`, and `converge guards` against a sidecar-free, write-refusing
fixture and checks unchanged database bytes. Root verified that exact targeted
scenario passing in `/tmp/torch-cli-reader-independent-YpA8xa/candidate` after
providing dependencies. An initial invocation used the wrong working directory
and failed importing `zod` before assertions; that setup failure is not a
behavioral test result. No composed `85914d3` plus `cdc3aa9` candidate, native
check receipt, installed qualification, or integration is asserted here.

### Compact-card source corrections

Candidate `29afa15` initially left long title/domain metadata unbounded: an
isolated headless reproduction grew a card from 407px to 2,803px. Its current
controls link also left the modal open over the destination. Correction
`063034274a9e42b589aed6ef6071780b06f9a3b7` bounds those fields and closes/routes
the modal. Root independently ran all six focused browser scenarios successfully.
QA reported full-suite/check/dashboard/lint success for that source candidate.
This is hermetic demo evidence, not connected live desktop/mobile qualification,
uniform-height acceptance across every card type, or installed delivery.

The correction contains `Closes: TASK-console-compact-details`; the full task
remains incomplete. Manager reported that automatic closure refuses a blocked
task that is not ready to integrate. Preserve that boundary rather than making
the task integration-ready solely to land a source slice. Existing managed
Console branch `2261e9b` and its history remain separate from the detached source.

### Failed gates and operational requests

Runtime's converged `0bb5ca4a084ad19a99cef1d8ea3162bf29272f8f` and Kernel's
`85914d3` both reported full-suite cancellation at the existing 60-second
`cli-scenarios.test.mjs` boundary. Neither is a green full-suite result.
Runtime preserved its excerpt and audit in its worktree under
`test_logs/cli-suite-timeout-0bb5ca4a.observed-output.log` and
`reports/test-audit/cli-suite-timeout-report-2026-10-03.md`.
There is no TORCH check receipt for that direct `npm run test` invocation.
The captured file-level output does not identify an internal CLI subscenario.
No timeout increase, assertion relaxation, or retry-until-green was authorized.

Root submitted these concrete findings through durable owner requests:

- `700f9ac7`: live snapshot response took 9.182 seconds; the following static
  page response took 0.003552 seconds. Synchronous doctor/Git observation is a
  candidate cause, not a proven root cause. Profile without hiding stale state.
- `db2380f0`: configuration defines a one-slot browser resource, but full-test
  and dashboard-check resource lists are empty. Direct test commands have no
  queue receipt. This coordination gap is verified; its role in the timeout
  is not. Avoid new competing full/browser suites while diagnosing it.
- `0d25bf3e`: ordinary integration intake requires a registered specialist
  branch tip equal to the candidate SHA. Detached `626`/`859`/`cdc` do not meet
  that boundary, and Session Manager is not a feature-source identity. A
  reviewed lossless adoption path is needed; do not impersonate a specialist,
  reset its branch, import its whole future branch, or fabricate receipts.
- `ea12134f`: Owner Console had both live parent and native Codex child for
  approximately 42 minutes while its durable progress report remained old.
  Separate executor liveness from recent activity and actual waiting reasons.
  Age alone does not authorize termination, guard cleanup, or restart.

### Launch allowance and next actions

An audited one-day allowance permitted 96 automatic launches on UTC
2026-10-03, while the ordinary future daily cap remains 48. The ledger reached
96 and the live observation returned `daily-turn-cap`. In-flight turns were
allowed to finish; no ledger reset or further allowance was granted. The policy
uses UTC midnight, not local midnight. It is an invocation allowance, not proof
of token/cost governance or reboot-persistent scheduling.

Next work remains: independent current-candidate QA; deterministic diagnosis
of the failed CLI gate and correct resource admission; lossless candidate
adoption/intake; exact-SHA qualifying receipts; serialized integration;
installed sandbox/startup verification; connected live UI review; and the
remaining roadmap. Durable manager backlog and owner messages remain the
authoritative queue. This report does not close those tasks or broaden authority.
