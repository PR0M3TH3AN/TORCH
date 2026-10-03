# Manual owner recovery for retained unknown executor outcomes

The owner requested fixing the stalled fleet. Legacy runtime records lacked a
recovery API: three physically stopped executors remained `working/unknown` and
correctly refused duplicate launches. This change adds an owner-only, previewed
`recover-runtime` operation without schema changes or automatic recovery.

The owner explicitly selects a project-scoped systemd service invocation. Its
working directory and exact area argument must match this installation; its
terminal timestamp must match the retained identity update within five seconds
(systemd displays timestamps with one-second precision). Both service PIDs must
be zero, its cgroup absent, and no visible same-user native process may reference
the session or registered workspace. Physical state is checked again at apply.
Unreadable process visibility, an active service, foreign invocation or changed
identity refuses recovery. This is a **manual legacy operator binding**, not
cryptographic session provenance or protection against arbitrary same-user code.

Evidence is process-local, branded, single-use and expires after sixty seconds.
The service transaction compares the exact state/runtime/session/update snapshot,
sets presence to offline and writes an owner-attributed audit. Session, current
task and the unknown outcome are preserved. No task, test or launch is completed;
no process is killed, lease removed, schema migrated or provider started.

Preview and apply use the same implementation. Apply additionally requires the
session and update timestamp from the preview. Hosts/providers without verifiable
Linux/systemd evidence refuse this legacy recovery; no Boolean fallback exists.

## Bounded continuation pilot

`torch continuation enable --max-turns-per-day 12 --yes` approves only the
currently activated identity roster. `status` previews eligible identities;
`tick --limit 3 --yes` runs at most three normal guarded `up` operations. New
unacknowledged messages or assigned/in-progress task revision changes supply the
signal; an unchanged signal is not retried. Active/unknown identities, held turn
guards, detach, disabled policy and the daily UTC attempt cap prevent launch.
Attempts are charged before invocation, including failed/interrupted attempts.
The cap limits turns, **not dollars or token consumption**. Unknown quota remains
unknown. This controller makes no product/approval/assignment decisions.

`torch continuation pause --yes` prevents subsequent launches. Policy and attempt
ledger are separate atomic files so an in-flight turn cannot overwrite a pause.
Pause does not kill an already-running turn. A controller lock serializes ticks;
a crashed lock is retained rather than expired automatically. Each executor has
a separate physical turn guard held through classification and final presence,
so an agent reporting idle cannot permit overlapping native turns.

The first host pilot uses an explicitly installed transient user-systemd timer.
It survives this chat ending, but not a host reboot. Permanent installer-owned
provisioning/removal and installed artifact qualification remain existing backlog
work; this is not a claim that the alpha.3 installed package has been upgraded.

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-legacy-runtime-recovery
      given: "An exact retained working/unknown identity and stopped project invocation"
      when: "The owner previews and applies recovery"
      then: "Presence becomes offline once; session, task and unknown outcome persist with one owner audit"
    - id: SCN-legacy-runtime-recovery-refusal
      given: "Live, foreign, mismatched or incomplete stopped-executor evidence"
      when: "Recovery evidence is requested"
      then: "Recovery refuses without identity mutation"
    - id: SCN-legacy-runtime-recovery-cas
      given: "Issued proof followed by a changed identity, live process, expiration or forgery"
      when: "Recovery is applied"
      then: "Transactional recovery refuses and creates no success audit"
    - id: SCN-legacy-runtime-recovery-authority
      given: "A specialist actor or incomplete expected snapshot"
      when: "Owner recovery is requested"
      then: "Authority or snapshot validation refuses"
    - id: SCN-runtime-turn-guard
      given: "A physical executor holds an identity guard and reports idle early"
      when: "Another executor attempts the same identity"
      then: "It refuses until the first executor finishes and releases its own guard"
    - id: SCN-runtime-continuation
      given: "An explicitly enabled roster, a new durable signal and a fixed daily turn cap"
      when: "Continuation ticks, repeats a signal, exhausts its cap or is paused"
      then: "Only eligible new signals launch; deduplication, cap, owner authority and pause remain enforced"
  observable_outcomes:
    - "Durable presence, session and task state; owner-attributed audit; explicit refusal codes"
  determinism_controls:
    - "Hermetic Git/install fixtures, fixed clock and injected OS observation boundary"
  anti_cheat_rationale:
    prevents:
      - "Caller Boolean as stopped proof"
      - "Process stop promoted to successful task or test"
      - "Stale snapshot overwrites or silent peer impersonation"
      - "Expired, foreign or replayed proof"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```
