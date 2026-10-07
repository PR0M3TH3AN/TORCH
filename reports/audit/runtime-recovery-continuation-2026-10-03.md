# Owner repair and bounded continuation pilot

## Candidate and verification

Canonical development branch: `rewrite/portable-agent-fleet`.

- `11dabd2`: exact stopped-unknown owner recovery, physical turn guard, opt-in continuation.
- `4c42715`: reviewed Runtime MCP XDG runtime-directory forwarding, cherry-picked without its unfinished broader branch.
- `f823714`: bounded parallel turns and signal watermarks that do not wake on acknowledgements alone.
- Complete suite: 266 PASS, 4 skipped, zero failures/cancellations (`/tmp/torch-continuation-final-suite.log`). Syntax check and full lint PASS. Subsequent MCP focused suite: 6 PASS after removing unnecessary string escapes, with identical assertion semantics.

These are local/source verification results, not independent QA acceptance or an installed-release upgrade. No acceptance assertions or test timeouts were relaxed.

## Actual recovery

Owner-selected legacy units were verified terminal, with no live matching native process. The new public source CLI recovered these identities to offline, retaining prior unknown outcomes and runtime/session/task data:

| Identity | Owner audit |
| --- | --- |
| owner-console | cfae5b3d-695b-4657-95f0-cdba230741db |
| qa | 158bc692-e775-49a2-987f-8d9d3e8ffb9a |
| release-self-host | 7f618cd6-86cd-471f-a5f0-d7f03f8c6fb4 |

This is an explicit owner-selected legacy invocation binding, not cryptographic session provenance. Old failed units remain evidence. No processes were killed, task/test results forged, reservations fabricated, or schema migrations applied.

## Actual pilot

Project: `3dc11932-6e3c-42aa-9a8a-ca7b8f818b54`.

Transient user timer/service: `torch-3dc11932-6e3c-42aa-9a8a-ca7b8f818b54-continuation-pilot`.

First activation: 2026-10-03 04:00:18 UTC. Source CLI starts at most three existing approved identities concurrently, charges attempts before launch, and checks again two minutes after the previous batch exits. At verification, three attempts were charged and physical guards existed for session-manager, project-kernel and provider-runtime; their source `up` child processes were running. Daily cap: 12 turns, UTC day. This is a turn cap, NOT measured token/cost governance. No additional identities were authorized.

Monitoring URL returned HTTP 200: <http://127.0.0.1:4174/console>.

Pause future turns from the canonical repository:

```sh
node bin/torch.mjs continuation pause --yes --json
```

Pause does not kill already-started turns. Inspect policy/eligibility with `node bin/torch.mjs continuation status --json`. The timer remains a cheap deterministic check when paused or capped.

## Remaining qualification

- Independent QA of this exact composed candidate and real native completion/continuation.
- Startup presence truthfulness: physical launches may still display idle until their first status report.
- Installer-owned persistent timer registration, removal, upgrade and reboot qualification. This transient timer survives chat exit, not host reboot.
- Crash reconciliation for retained controller/turn locks; no time-based expiry silently permits overlapping executors.
- Real usage governor, runtime/model/auth qualification and operational failure reporting.
- Existing umbrella tasks remain open; the previously observed CLI timeout still needs a root-cause diagnosis despite this passing run.

Installed alpha.3 runtime and console service were not replaced. The older schedule framework's automatic model wakes remain disabled; the source continuation pilot is separately authorized.
