# First TORCH-building-TORCH development pilot

## Owner authorization and live monitor

The owner requested a staged self-development fleet, with the outer assistant
as arbiter through Session Manager, then a quality release/update and a later
Claude Code/Pi substitution test. COMMON.md records the bounded first slice:
`TASK-conversation-runtime-diagnostics`. Other development work, remote pushes,
landing, public release, deployment, default-main promotion and provider migration
are not authorized by this pilot.

Monitor: **http://127.0.0.1:4174/console**. The snapshot is installed mode for
project `3dc11932-6e3c-42aa-9a8a-ca7b8f818b54`, not demo state. The original
Console process died during an outer-daemon restart. It was restored as the
loopback-only transient user service
`torch-3dc11932-6e3c-42aa-9a8a-ca7b8f818b54-console-pilot.service`, outside the
assistant process lifetime. This is not yet a reboot-persistent installed
Console integration; automatic service provisioning remains backlog work.

## Real agent evidence

- Session Manager resumed the same Sol runtime and assigned the real task to
  Provider Runtime with revision-checked proposed → ready → assigned transitions.
- Provider Runtime started as the configured Terra model, retained runtime
  session `01a0f3e1-9106-72c3-b8b2-2f1cc5322ccc`, queried ownership and requested
  QA consent before editing tests. It committed production changes at
  `c362ccd5cc8fff94c59d4a0c8f178628dc5e7596` on its own branch. That is not landed
  or accepted release evidence.
- QA ran real Terra coordination turns and gave exact additive-test consent for
  `test/fleet/lifecycle.test.mjs` and `docs/TEST_INTEGRITY.md`, retaining existing
  assertions and requiring independent exact-candidate review.
- A daemon restart interrupted implementation. The arbiter checked owned live
  Codex process absence, preserved dirty code/tests/generated screenshots and
  resumed the same assignment via a transient `runtime-pilot-turn` user service.
  No unrelated process was killed or user work reverted.

Provider-reported focused checks passed, but its generic full-suite failures and
final regression evidence still require exact-source qualification. Do not infer
completion from a commit, active process or green controller receipt. Generated
test screenshots remain agent work and must not be blindly committed as changed
expectations. First launch presence lag and assigned-versus-working task state
need review; startup badges are not independent process-liveness proof.

## Machine scheduler: qualified setup, guarded AI execution

The owner-approved hourly check-in policy retains a maximum of 12 automatic
invocations per UTC day in subscription invocation-count mode, not a USD cap.
The project-owned persistent systemd timer was explicitly installed for the
pilot. This manual qualification does not implement automatic init/install yet.

Initial live install exposed invalid `WorkingDirectory="/absolute/path"` output.
The actual parser rejected it, while file-based status said installed and the
timer was enabled but inactive. Minimal source repair `d636cae` emits an absolute
scalar path with C escaping and literal specifier handling. A new native-parser
scenario includes spaces, percent and quote characters. Fourteen scheduling tests
and all 39 source acceptance groups PASS; no existing test was weakened.

Reconciliation used the tested source CLI and preserved owned-file hashes. The
timer is active and its first dispatch produced a durable check-in and wake
receipt. Installed stable tool remains alpha.2; the repaired scheduler currently
executes the source CLI, not a newly packaged stable release. A later qualified
tool update must incorporate the repair and reconcile the launcher.

The first automatic manager invocation lasted exactly the 300-second executor
limit and was recorded succeeded/invoked. Independent model-turn completion was
not established. A native local child trapping SIGTERM reproduced
`status: 0`, `signal: null`, `error: ETIMEDOUT`; current startFleet ignores the
error when exit status is zero. This confirms a false-success boundary, not
independent proof of how that particular model turn ended. Historical receipts
were preserved, not rewritten.

Automatic AI wakes are therefore **disabled** until `TASK-pilot-executor-outcomes`
is fixed and qualified. The timer remains active for durable machine coordination;
the arbiter explicitly drives the bounded specialist turns. Do not claim the
fleet is ready for unattended autonomy.

## Backlog and next gates

The original 34 conversation follow-ups are preserved. Three observed pilot
issues were added through audited owner intake: starting presence, native unit
rendering/operational status and executor timeout/outcome semantics. The manager
backlog remains the authoritative queue, separate from this narrative report.

Recovery follow-up: the specialist produced regression commit `2f1ca15` but exact
TORCH check planning was blocked by five tracked report images generated by the
dashboard gate. The owner/arbiter gave narrow reversible archive-and-restore
directions for proven check-owned outputs, not permission to rewrite expectations.
`TASK-pilot-generated-check-artifacts` records the durable fix. The explicitly
requested post-quality-release whole-fleet provider migration now has its own
`TASK-provider-handover`, dependent on release qualification. Total intake is
39 items (34 original follow-ups plus five later pilot/handover items); one real
implementation assignment does not imply the rest are dispatched.

1. Finish diagnostics regression evidence and independent QA review.
2. Fix executor outcome/launch-presence guards and qualify one real bounded wake.
3. Complete reviewed automatic init/install onboarding and persistent operations.
4. Expand the fleet's scope only after a successful bounded work/verification/
   landing/resume cycle; never directly push competing specialist branches.
5. Build/accept/update a quality artifact with current receipts, then separately
   test Claude/Pi handover of the same durable identities, tasks, messages and
   checkpoints. No model/provider swap occurred in this pilot.

Receipts are under `/tmp/torch-pilot-*`, including repaired full-source acceptance,
native parser tests, scheduler installation/reconciliation, durable wake/run
state and owner-request messages. The live dashboard and actual branch state
take precedence over historical progress descriptions in this report.

## Continued pilot and owner UX feedback

The owner approved continuing the controlled pilot and is watching the Console.
Independent QA reviewed candidate `ae18a98e2911aa515d0484518013061b05ff6adf`:
the lifecycle scenario independently PASSed 7/7, with no assertion relaxation.
QA accepted code/scenario content, **not integration qualification**. Required
dashboard receipt remains incomplete and canonical convergence remains required.
QA's durable report is message `8275d64a-7b28-49ee-a379-2c6d0bdcacb3`.

Two additional owner-intake proposals bring the backlog to 41:

- `TASK-owner-agent-chat`: threaded durable owner conversations and reviewed
  wake-on-message after executor/presence qualification. Current agent message
  recipient validation does not permit the owner as a recipient; owner replies
  need a distinct authorized API, not an invented specialist identity.
- `TASK-console-ux-audit`: the owner rejects excessive scrolling and a generic
  all-in-one-page dashboard. Session Manager has an explicit bounded assignment
  request for existing Owner Console. Require actual computer-use navigation,
  inspected screenshots of every current area, desktop/mobile and interaction
  coverage, and a focused multi-screen proposal. Live state is read-only; demo
  may exercise mutations. Missing browser tools are a blocker, not permission
  to claim a source-only audit completed the request.

Canonical COMMON now permits this audit in parallel with diagnostics QA, without
authorizing UI implementation, unrelated dispatch, automatic wakes or release.
The arbiter launches Owner Console only after actual manager assignment; a
request in an inbox is not itself assignment evidence.

## Attention-panel triage and audit recovery

Session Manager assigned `TASK-console-ux-audit` to Owner Console at revision 3.
The first audit turn **did not perform browser coverage**: installed `torch brief`
failed with `ERR_SQLITE_ERROR` / read-only database. The identical installed brief
passes from the host. The arbiter resumed the same session with directions to
request narrowly scoped escalation for that exact command, not change permissions
or skip the guard. `TASK-pilot-brief-sandbox` captures durable qualification.

Owner additionally requests contextual quick actions in Needs your attention.
`TASK-console-attention-actions` requires meaningful per-agent/branch findings,
deduplicated messages and owner-only reviewed approve/reject actions. Total
owner intake is now 43. It does not authorize warning dismissal, blanket message
acknowledgement, automatic merging or remote publication.

Observed worktree warnings: manager backlog updates are dirty, and manager and
Provider Runtime retain unique commits. These are preserved task state and
unlanded work, not permission to remove worktrees or discard commits. The manager
has a narrowly authorized local backlog checkpoint/convergence request and must
review its own inbox. Provider code still requires integration gates.

Recovery is `ONE-DISK` for current rewrite HEAD: origin exists, but local
remote-tracking references do not contain that commit. This is not proof of a
live remote query. Off-machine synchronization requires an explicit owner
publication/backup decision; no remote push or default-main promotion occurred.

## Bounded coordination and reliability follow-through

The owner clarified that ordinary peer coordination should not require human
relay. Live COMMON and Session Manager instructions now require own-inbox review,
named-approver decisions, durable unresolved waits and direct responsible-peer
follow-up. Spending, publication, releases, scope/ownership changes, destructive
recovery and owner-addressed approvals remain reserved. There are 44 backlog
items; `TASK-bounded-routine-coordination` carries this policy into fresh installs.

Project Kernel committed candidate `d3a679849b0f5e55c2114223a2e56977c318391e`.
The arbiter independently ran its new routine-coordination test: **2/2 PASS**.
This covers generated instruction surfaces, acknowledgement not completing work,
and named-approver enforcement. It does not independently prove paused runtime
execution or full integration qualification. QA has a review request for that
coverage gap. Kernel reports test/check/lint evidence, but its dashboard gate is
blocked: root Playwright is 1.58.2, Kernel's installed dependency is 1.63.0, and
the latter expects absent `chromium_headless_shell-1243`. QA and manager were
asked to resolve reproducible setup, not waive assertions or use an unverified
browser substitution.

Session Manager explicitly blocked the earlier runtime diagnostics task while
preserving its accepted candidate and incomplete dashboard receipt. It then
assigned `TASK-pilot-executor-outcomes` to Provider Runtime and
`TASK-pilot-generated-check-artifacts` to Work and Integration, one active item
per specialist. Named QA additive-test/output-plumbing consent and Release CLI
consent were requested through the control plane. The arbiter started their
review turns and both assigned implementation turns using separate owned
transient user services. A running service proves an active launch handle, not
task completion or successful native terminal output.

Owner Console is continuing its actual browser audit through a bounded temporary
diagnostic launcher. The launcher captures outcome metadata only, checks terminal
turn evidence and refuses false success. Its larger output buffer is diagnostic
recovery, **not an installed engine fix**. The permanent executor task must handle
timeouts, signals, errors, output overflow and uncertain captured identities.
Automatic wakes remain paused; no remote push, release, installation update or
default-main promotion has occurred.
