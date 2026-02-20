# known-issues-agent memory update (2026-02-20)

- `test/scheduler-preflight-lock.e2e.test.mjs` platform mismatch issue no longer reproduces; move to resolved and stop treating as Codex blocker.
- Codex sandbox has reproducible permission constraints affecting tests that bind sockets (`listen EPERM`) or spawn shell commands (`spawnSync /bin/sh EPERM`); document separately from product defects.
- `test/memory-telemetry.test.mjs` remains active due empty captured child stdout/stderr under this environment even when fixture passes standalone.
- Relay health preflight from this sandbox still reports all relays unhealthy with DNS resolution errors (`ENOTFOUND`), so scheduler lock issues remain monitoring/active depending on environment.
- For daily known-issues runs in restricted sandboxes, prioritize accurate status+repro updates and incident capture over risky test rewrites.
