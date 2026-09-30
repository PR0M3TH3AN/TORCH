# Same-runtime browser qualification — 2026-09-30

The explicit qualification service holds one real Chromium page across three
actual subprocess commands: preflight probe, measurement and postflight probe.
It serves captured build files from a disposable project's snapshot. The page
generates its own random runtime identity and advances a simulation counter on
animation frames. Probes observe DOM build/commit, actual clock advancement and
visibility; they do not simply return expected policy values.

Seven focused scenarios PASS, zero skips:

```sh
TORCH_QUALIFY_BROWSER=1 node --test --test-name-pattern='SCN-real-browser-conditions|SCN-real-frozen-browser|SCN-check-' test/fleet/verification-resources.test.mjs test/fleet/check-conditions.test.mjs
```

The actual CheckService produces:

- Healthy: pass with identical browser identity before/during/after measurement.
- Frozen before preflight: incomplete, zero measurement requests.
- Clock freezes during measurement: command exits zero but postflight invalidates
  its result; exact-pass lookup remains false.
- Runtime replaced during measurement: replacement clock/build conditions are
  healthy, but changed browser identity invalidates the result.

Runtime continuity was previously only a harness obligation. TORCH now rejects
changed or missing postflight `runtimeId` when preflight supplied one, and rejects
malformed supplied IDs before measurement. IDs remain project-reported metadata;
absence in both probes remains backwards-compatible, not proof of continuity.
Exact-pass qualification revalidates stored reports under the current contract;
historical green flags with mismatched runtime IDs cannot bypass it. The real
scenario verifies that rejection through stored receipt lookup as well.

Browsers and loopback servers terminate through explicit IPC shutdown; completed
snapshots are removed. No AI providers, fleet sessions, host timers, deploys or
stable installs were started. Focused lint and diff hygiene PASS.

Full isolated current-source acceptance PASS (38 groups, tests/lint/syntax):
`/tmp/torch-same-runtime-browser-final-20260930-acceptance.json`.

## Remaining gates

This proves one persistent harness, not arbitrary project adapters. It does not
qualify GPU acceleration, COMBATRIG game time, transient drift that recovers
between probes, independent sensor truth, hard-killed executor recovery or disk
allocation. Projects must instrument drift through the measurement interval;
endpoint probes alone cannot prove uninterrupted validity.
