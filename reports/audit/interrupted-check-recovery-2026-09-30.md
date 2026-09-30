# Interrupted prepared-check recovery — 2026-09-30

The Linux qualification starts an actual CheckService runner and real Node
measurement subprocess. The subprocess reports its PID and blocks until explicitly
terminated. Recovery while the recorded runner lives is refused. The owned runner
is killed and its exit observed; the owned executor is then terminated through a
kernel pidfd and its terminal notification awaited without sleep/poll retries.

Reopening CheckService observes persisted running state and intact inputs; it
cannot rerun the prepared operation. Recovery requires the configured owner,
explicit approval, stopped-executor/descendant attestation and evidence.
`abandoned` state and the original audit commit atomically before cleanup.

An altered ownership marker causes cleanup to remain pending with inputs intact.
Restoring the exact original marker permits explicit replay cleanup, with one
original authority audit. Recovery never creates a receipt, invokes an executor,
releases a lease or changes source files. Owner CLI previews, refusal without
confirmation and replay are exercised. Frozen-pass qualification also rejects a
receipt lacking linkage to a finished prepared operation (simulated crash window).

Qualification command:

```sh
TORCH_QUALIFY_BROWSER=1 TORCH_QUALIFY_INTERRUPTION=1 node --test test/fleet/verification-resources.test.mjs test/fleet/check-snapshot.test.mjs test/fleet/check-conditions.test.mjs
```

The interruption test is explicit opt-in on Linux and uses Python pidfd support
only as a qualification helper. TORCH itself does not require Python. Ordinary
skipped scenarios are not evidence of hard-interruption qualification.

All 15 focused scenarios PASS with zero skips, including real Chromium and hard
interruption. Full isolated current-source acceptance PASS (38 groups,
test/lint/syntax); receipt `/tmp/torch-interrupted-check-20260930-acceptance.json`.
Focused lint and `git diff --check` PASS.

## Boundaries

- Process observation tracks the runner, not all descendants. The owner evidence
  must cover descendants separately; stale/unknown/foreign runner identity is
  not automatic proof of their termination.
- No automatic kill, retry, restart, lease theft or stale-time abandonment exists.
- Browser descendant interruption, other-platform recovery and Console visibility
  for abandoned checks with pending cleanup remain open qualification/work items.
- No live agents, host timers, deployments, COMBATRIG changes or stable installation.
- Captured disposable test inputs were removed only through owned cleanup;
  original source/build inputs remained intact.
