# Browser descendant interruption — 2026-09-30

`SCN-browser-descendant-interruption` launches real Chromium through an actual
prepared measurement subprocess, serving frozen captured HTML and exact source
identity. Only the disposable TORCH runner is killed first. The remaining harness
can still query real page DOM/visibility, proving that stopped runner metadata is
not evidence of stopped browser execution. Recovery without all-executor stopped
confirmation fails and preserves captured inputs.

Before explicit harness shutdown, the qualification opens Linux pidfds for the
owned harness and currently observed isolated browser group. Browser/harness PID
birth identity and isolated group ownership are checked. Multiple actual Chromium
processes must be observed. After explicit shutdown, kernel terminal events are
awaited for those handles and no live member of the isolated group may remain.
No sleeps, guessed elapsed-time death, or retries are used.

Only then does owner-confirmed recovery record abandonment and clean the owned
snapshot. It creates no receipt/pass and leaves the browser lease held until its
owner explicitly releases it. Original live build files remain intact.

Qualification command (16 focused scenarios PASS, zero skips):

```sh
TORCH_QUALIFY_BROWSER=1 TORCH_QUALIFY_INTERRUPTION=1 node --test test/fleet/verification-resources.test.mjs test/fleet/check-snapshot.test.mjs test/fleet/check-conditions.test.mjs
```

Full isolated source acceptance PASS (38 groups, tests/lint/syntax):
`/tmp/torch-browser-descendant-interruption-20260930-acceptance.json`.
Focused ESLint and diff hygiene PASS.

## Boundaries

This proves one explicitly owned Linux Chromium harness and its captured isolated
process group. It does not discover every arbitrary project descendant, escaped
group, foreign host process or other-platform executor. TORCH runtime recovery
still requires owner evidence; the Python pidfd helper is explicit qualification
instrumentation, not a product/runtime dependency or an automatic kill service.

No live agents, host timers, stable installation, deploys or COMBATRIG changes
occurred. Test-owned browser/harness processes stopped; only owned disposable
snapshots were removed and source/live build inputs were preserved.
