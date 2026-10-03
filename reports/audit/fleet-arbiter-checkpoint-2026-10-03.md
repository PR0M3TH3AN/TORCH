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
