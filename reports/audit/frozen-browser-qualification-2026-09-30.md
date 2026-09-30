# Frozen queued-browser qualification — 2026-09-30

## Evidence

`SCN-real-frozen-browser` uses real Chromium, a loopback HTTP server,
disposable installed Git project/worktrees and the actual resource/check services.
A peer holds the browser slot; the specialist captures its ignored build and
queues. Execution without the lease fails. The specialist then commits newer
source and overwrites its live output in place. After promotion, a reopened
CheckService executes the frozen build through an explicitly configured absolute
harness path (Playwright dependencies resolve from the TORCH checkout).

The browser observes the old build and captured commit. Retained output matches
the input digest, exact-pass lookup rejects the newer SHA, and completed snapshot
cleanup leaves the live build unchanged. A second capture of the new build fails
the unchanged browser expectation, proving the harness does not simply return
success. Both browser processes and loopback servers close.

The first run failed: measurement commands lacked the captured-subject environment
variables already supplied to condition probes. `executeConditionedCheck` now
passes `TORCH_CHECK_COMMIT` and `TORCH_CHECK_INPUT_DIGEST` to measurements too.
`SCN-check-measurement-subject` uses actual child commands to enforce this for
checks with and without condition policies. Assertions were not relaxed.

Focused command (five scenarios PASS, zero skips):

```sh
TORCH_QUALIFY_BROWSER=1 node --test --test-name-pattern='SCN-real-frozen-browser|SCN-check-' test/fleet/verification-resources.test.mjs test/fleet/check-conditions.test.mjs
```

Browser qualification is explicit opt-in because Chromium installation and
loopback permissions are not requirements for a headless kernel installation.
Ordinary acceptance runs do not count the skipped browser scenario as proof.

Full isolated current-source candidate acceptance PASS; receipt:
`/tmp/torch-frozen-browser-20260930-acceptance.json`. Focused ESLint and
`git diff --check` PASS. No existing assertions were weakened or deleted.

## Not proven

- GPU acceleration, a game simulation clock, or COMBATRIG compatibility of this harness.
- Independent condition sensors or same-runtime pre/post probe coordination.
  The browser checks visibility and advancing browser performance time only.
- Actual filesystem reflink allocation or zero additional disk use.
- Hard-killed executor recovery; reopening an unstarted prepared check is not that proof.
- Portability of arbitrary project harness dependencies; this exercises one explicit path.
- Installed fleet/provider lifecycle. No agents, host timers, deploys or stable
  TORCH installation were started.

The full queued-browser roadmap item remains open for these qualification gates.
