# TORCH readiness audit — refreshed 2026-09-30

Later checkpoints qualified frozen/same-runtime/browser-interruption scenarios,
implemented scheduled stale-work review and surfaced cleanup outcomes. See the
individual current reports and `self-host-roster-review-2026-09-30.md`. The latest
pending intake has 15 baseline domains, 13 unassigned components and 41 boundaries;
the 08:34 14/14/39 snapshot below is retained as historical evidence. No source
commit, stable install or live fleet lifecycle has occurred since this snapshot.

This is a source/readiness audit, not proof that the full goal is complete.
The authoritative release definition is specification section 32: a real,
local-only multi-domain fleet must assign, coordinate, verify, integrate,
stop/resume and detach without losing identity or damaging user code.
Source tests and an isolated dashboard demo do not prove that exit gate.
The final trial must specifically include at least two coordinating domain
managers; a one-manager/two-specialist rehearsal is insufficient. Current
read-only status revalidated after bootstrap fixes still has generation zero,
no installed versions or stable launcher and `CANDIDATE_SOURCE_DIRTY`.

## Current authoritative state

- Rewrite branch: `rewrite/portable-agent-fleet`; committed HEAD
  `d31437a4fb255c1e307bbb70ee9513cc1e0bdf4c`; extensive tracked/untracked
  implementation changes remain uncommitted. No changes were discarded.
- `main` and `legacy/nostr-torch` both resolve to
  `a46832314f6a32c6636ae8ff672df8c3e67e2672`. The preserved package explicitly
  describes the former Nostr task-locking product. Legacy development-network
  branch resolves to `b026a6e6fcd855b9fd158c388629d93f297e486c`.
- Current `candidate status`: generation zero, no installed/active/previous
  version and no stable launcher. Current candidate planning rejects the
  checkout with `CANDIDATE_SOURCE_DIRTY`; it copied no candidate.
- Fresh bootstrap intake: `/tmp/torch-selfhost-intake-20260930-0838.json`,
  generated `2026-09-30T08:34:22.289Z`, fingerprint
  `bcd69eb6048d5cca2e89f2eaa32440f21a4bfdc9876f345bb244a02645817467`.
  It contains **14 candidate domains**, **14 unassigned components** and
  **39 coordination boundaries**. This supersedes the older ten-domain,
  eighteen-unassigned, twenty-four-boundary assessment. It is pending review,
  not an approved organization or a request to launch fourteen agents.
- Unassigned components: `bin`, `core`, `scripts`, `src`, `src-artifacts`,
  `src-console`, `src-control-plane`, `src-convergence`, `src-forge`,
  `src-importers`, `src-integration`, `src-resources`, `src-self-host`,
  `src-telemetry`. These include essential implementation surfaces.
- Report/doc edits after intake can invalidate its fingerprint; regenerate
  after the final source checkpoint. Do not install from this temporary brief.
- The protected pre-existing `test-torch-config-host-uQKdqL/` remains outside
  managed trial scope. Candidate source selection excludes untracked files;
  a scoped checkpoint must include required new source/assets/tests without
  accidentally adopting that fixture.

## Requirement-to-evidence map

| Requirement | Current evidence | Remaining exit gate |
| --- | --- | --- |
| Legacy preservation and replacement product | Actual branch hashes above; rewrite source and product pages | Scoped checkpoint and eventual replacement promotion to `main`; no remote push authorized by this audit |
| Portable install/reversal on existing repositories | Real Git fixtures in `kernel-lifecycle.test.mjs`: `SCN-install-doctor-purge`, `SCN-existing-repository-preservation`, `SCN-install-trackability` | Committed release artifact and actual installed tool qualification |
| Repository/spec-aware project-specific bootstrap | Architecture graph, fingerprinted specifications, pending six-area consolidation, duplicate-primary ownership rejection and specialist-only repository scenarios | Regenerate after checkpoint; owner review of exact roster and root metadata/schema boundaries; a paid Architect call is optional, not an approval prerequisite |
| Durable provider-independent control plane | SQLite identities/messages/approvals, identity-bound stdio MCP handshake and CLI scenarios | Real manager plus specialists complete a coordinated change |
| Current instructions and resume-first backlog | `SCN-current-instructions-on-resume`, single-active assignment/self-claim/race and blocked-resume tests | Live stop/resume and autonomous settle/claim behavior |
| Claude/Codex/Pi/custom runtime choice | Mixed adapter planning and local MCP/extension boundaries; per-identity profiles/defaults | Live mixed-provider coordination/resume with explicit usage limits; offline extension loading is not a provider turn |
| Local checks, scarce resources and frozen inputs | Exact-SHA checks, FIFO leases, real queued Chromium capture/rebuild, same-runtime condition probes and Linux browser-descendant interruption qualification | Actual project GPU/game probes, disk allocation, transient drift and arbitrary/other-platform harness interruption qualification |
| One serialized integration path and local-only canonical Git | Real disposable Git integration/closure and conflict/failure recovery scenarios | Real fleet submits independently tested branches; no direct pushes to main; actual interruption trial |
| Forge attach/detach/outage and safe fetch | Real local remotes in `forge-migration.test.mjs` and `canonical-fetch.test.mjs`, owner-confirmed non-publishing object import | Real network classification; local remote fixtures do not prove hosted authentication or outage behavior |
| Adaptive hierarchy and manager check-ins | Graph authority tests, pressure/pilot/adoption/reversal scenarios; bounded wake reservations and typed owner-digest scheduling | Actual fleet-pressure evidence, live adoption/reversal, owner-authorized systemd install/dispatch/reversal and stopped-runtime proof |
| Delivery lifecycle, uncertainty and retries | Durable attempt reservations, classifications, saved-success/not-applied recovery and independent authority boundaries | Real project adapters, provider receipt identity/idempotency and stopped-executor qualification; no public release inferred |
| Stable/candidate isolation, upgrade and rollback | Disposable HOME/XDG gates, version-store fixtures, atomic pointer/journal/rollback tests | Install a commit-bound accepted candidate; stable TORCH actually manages its successor on this repo |
| COMBATRIG portability | Read-only importer plus legacy fixture compatibility and preserved prompt/check/authority provenance | Old 56-blocker report is historical, not a current COMBATRIG audit; separately authorize fresh intake, resolve ownership, compare and cut over |
| Website, actual dashboard demo and owner controls | Shared Console/demo, actual Playwright desktop/mobile interactions, protected live refresh, source HTTP tests | Public/package release approval; native background/back-cache and real installed-fleet qualification |

Configurations A–I in specification section 29 remain only partially qualified:
local Git/kernel/forge fixtures cover mechanics, but A/G/H/I explicitly require
real operational fleet evidence. None is upgraded to complete merely because
the matching source scenarios pass. Section 32 remains **not achieved**.

Fresh verification: all 38 required source acceptance groups PASS, including
full tests/lint/syntax, receipt
`/tmp/torch-readiness-audit-20260930-acceptance.json`. Actual Playwright
desktop/mobile demo and controlled protected-refresh scenarios PASS with zero
live API calls. Diff hygiene PASS. These checks use local/disposable or demo
state and deliberately do not satisfy the live-fleet exit gates above.

## Ordered next work

1. Preserve completed local qualification: real frozen queued-browser execution,
   same-runtime probes, Linux interruption and scheduled stale-work mechanics now
   have source evidence. Remaining real project/provider/installed cadence gates
   must not be substituted with another repetition of those source scenarios.
2. Review the accumulated source scope and required new files, preserving the
   protected fixture and parallel work. Produce a clean commit-bound checkpoint;
   do not weaken dirty-source acceptance or substitute an artifact-mode build.
3. Generate a fresh TORCH brief and review ownership for every omitted component,
   plus shared CLI/schema/package/test interfaces. Fewer coherent specialists
   are preferable to blindly approving the deterministic fourteen-domain roster.
4. Build/test the committed candidate and review tool activation/project-install
   plans separately. Installation must not implicitly start agents or timers.
5. Once ready, obtain explicit provider/budget authority for the section-32
   bounded live trial, then separately qualify timers, adapters and COMBATRIG.
6. Promote the replacement/default branch and publish/deploy only under the
   corresponding release authority. Retain rollback/legacy recovery boundaries.

No provider, host timer, stable installation, project fleet, remote publication,
deployment or COMBATRIG mutation was started during this audit. Remaining safe
implementation work exists; this is not a blocked-goal or completion claim.
