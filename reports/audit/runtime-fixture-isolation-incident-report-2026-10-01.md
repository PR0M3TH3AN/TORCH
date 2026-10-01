# Runtime fixture isolation incident and Fleet reconciliation

Task: `TASK-pilot-executor-outcomes`. Current instruction digest:
`0e4eafe9870c7a6d6edd406f248c86b27861a26c1a4329c3fc1d5622b2b56706`.

The actual CLI fixture attempt is invalid. Owner message
`44cbf3ad-ed46-44bd-979f-1613ca5fa456` reports that injected PATH influenced
adapter detection but was omitted from launch spawn options, allowing the host
Codex executable to launch. Manager source inspection confirmed that the three
`executeRuntimeLaunch` callers in `src/cli.mjs` omitted the injected environment.
No test or provider was launched by Manager.

Owner correction `593aedc7-700c-44a4-921b-30e94f1c38ac` supersedes the earlier
cleanup claim: observed fixture PIDs had already exited before the attempted
signal, so the arbiter sent no signal. Runtime separately claimed process-group
termination; Manager requested precise evidence for any distinct action rather
than treating these accounts as equivalent. A read-only scan of accessible
`/proc` cwd/exe/comm found no remaining process whose cwd was the recorded fixture
directory `/tmp/torch-cli-worktrees-4HI3gF/executor-outcomes-fixture/core` or a
descendant. This bounded observation is not a general claim that no processes
exist elsewhere. No command lines, credentials, fixture files or global settings
were inspected or changed.

Live ownership confirmed CLI belongs to Release. Release message
`21191a30-f59c-436c-8e95-f06f37b08f0d` grants consent only to pass injected
`runCli` env at the existing fleet-up, domain-start and scheduled-manager launch
sites. All spawn options and authority, pause, budget, identity and scheduler
guards must remain. No global `process.env` mutation is permitted. Manager
forwarded this precise decision directly to Runtime; it resolves the path-consent
wait, not task acceptance. Tests must prove fake-executable invocation by a
marker and bounded failure without real provider/network calls or extra fixture
processes/signals. The prior invalid run cannot count as qualification.

Runtime HEAD remains `f4594e9a3767b5e7bc3284b5c81872c6143c0760`; its QA-consented
test and integrity-note edits are dirty and preserved. Backlog revision 4 remains
`in_progress`, and next-task lookup returned `resume`. Its recorded `12e1e33`
receipts are historical evidence, not qualification of the newer checkpoint or
dirty edits. No artificial blocked/unblocked transition or second assignment was
created. Exact required checks and the dashboard gate remain open.

Canonical is clean at `3ea8d6e47a0a2a0daa20ebfb6c83c41a1ef1a246`. Work Integration
is clean at `e35046908f741799be9e814cecc6470cf1983b86`; its integration request
remains ready, unauthorized and unlanded. Owner landing approval
`2b2dfb35-46ac-4adb-ac14-5680f7a85e80` remains pending after the automatic approval
review rejection. No retry or bypass was attempted.

Kernel remains at `8350e47b0f92f7d41454a8e9a1b59e645b95eefe` with exactly the five
known tracked dashboard PNG modifications. Recovery approval
`406ff30e-b317-4733-b39e-f63c9a57506d` remains pending under the interrupted-decision
hold; no restoration or decision retry is authorized without fresh clarification.
Console is clean at `eab85dd61dd42302d1160b60449d801dbe911dea`, a report-sync
checkpoint after its blocked revision 5 candidate. Required mobile visual
evidence is still incomplete. QA and Release worktrees are clean. Presence is
idle across the roster; this does not resolve assigned work or authorize cleanup.

The durable backlog contains 44 tasks: 39 proposed, three blocked, one
in progress and one ready to integrate. Health reports no anomalies, while
historical activity coverage remains incomplete and truncated at 1,000 commits.
Fleet evolution and the 30-day hierarchy assessment meet advisory thresholds
mainly through seeded proposal overlap and four coordination requests. Existing
Runtime/Release/QA ownership coherently covers the current incident. Prefer
precise peer consent, executable isolation and per-action evidence over adding,
promoting, splitting or retiring a role. Retain six specialists; no Fleet change
proposal or new dispatch is justified in this cycle. Wakes remain paused.
