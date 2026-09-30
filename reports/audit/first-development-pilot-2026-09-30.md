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
