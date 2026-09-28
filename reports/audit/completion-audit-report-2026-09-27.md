# TORCH portable-agent-fleet completion audit report

Date: 2026-09-27  
Branch: `rewrite/portable-agent-fleet`  
Audited specification: `docs/PORTABLE_AGENT_FLEET_SPEC.md`  
Latest audited implementation commit: `d8ab841`

## Verdict

TORCH has a coherent, scenario-tested local implementation of the portable
kernel, project-specific fleet design, persistent provider-independent control
plane, Claude/Codex adapters, exact-commit verification, resources, native
integration, safe convergence, schedules, context-locality telemetry,
self-host candidate mechanics, COMBATRIG import, dynamic domain creation,
retirement and boundary proposals, optional forge migration, a separately
authorized delivery lifecycle, standalone package qualification, the public
product surface, and the local Fleet Console.

It is not yet a qualified first usable release. The remaining release gates
require owner-authorized operational qualification:

1. owner-authorized installation and live qualification of the implemented
   persistent user-systemd schedule launcher;
2. owner-authorized live Claude/Codex coordination and resume evidence;
3. an installed stable TORCH managing this source checkout;
4. owner resolution of COMBATRIG's 56 blocking ownership/exclusion gaps,
   followed by an authorized cutover trial;
5. package publication and public website deployment.

Passing local tests do not close any live/provider/install/deployment gate.

## Evidence baseline

- `npm test`: **61/61 PASS** against the tree committed as `d8ab841`.
- `npm run lint`: **PASS**.
- `npm run check`: **PASS**.
- `git diff --check`: **PASS**.
- Focused bootstrap, adapter, and lifecycle scenarios: **8/8 PASS**, including
  installed-contract command planning, provider-specific ID capture,
  mixed-runtime planning, and durable resume behavior.
- No live AI provider was called.
- Headless Chromium rendered the public surface at desktop and iPhone 13
  viewports. The refined mobile page had zero horizontal overflow; keyboard tab
  selection, the routing-board interaction, and the installed `torch bootstrap`
  onboarding command were exercised successfully.
- An isolated temporary self-host qualification built commit `6740f33` as
  candidate `0.1.0-alpha.0`, recorded passing test/lint/syntax evidence,
  atomically activated it, and executed its stable `torch` launcher. The
  installed artifact excluded the pre-existing untracked owner fixture.
- No stable version, system service, timer, COMBATRIG state, remote branch, or
  public deployment was changed.
- The pre-existing untracked `test-torch-config-host-uQKdqL/` fixture remains
  untouched and untracked.

## Delivery-stage matrix

| Stage | Current evidence | Status | Exit-gate work |
| --- | --- | --- | --- |
| 0. Preserve and specify | Legacy branches `legacy/nostr-torch` and `legacy/development-network-v2`; rewrite branch; canonical spec and scenario inventory | Implemented locally | Owner product-boundary approval is represented by continuing this rewrite; no remote push was performed. |
| 1. Portable kernel | `src/kernel/`; strict `torch.dev/v1alpha1` validation in `src/kernel/config.mjs`; install/doctor/uninstall/worktree scenarios; ignored tracked state is refused before mutation; ownership-safe overlays preserve unrelated pre-existing `.torch` history; ordinary uninstall safely winds down sessions and removes only unchanged manifest-owned launchers while preserving organization/history; confirmed purge validates local identity and refuses active or unowned state | Implemented locally | A future schema needs an actual migration transform; unknown versions currently fail closed with an explicit migration blocker. |
| 2. Project decomposition | Repo/spec analysis, architecture graph, pending proposal, Session Architect brief and guarded Claude/Codex planner; one shared renderer gives initial and later-added domains the complete approved ownership, checks, authority, invariants, backlog, and first-move contract; `SCN-domain-collision`, `SCN-spec-fleet-design`, `SCN-ai-fleet-bootstrap`, `SCN-ai-fleet-planning`, `SCN-bootstrap-acceptance` | Implemented locally | Live runtime qualification remains in Stages 3 and 5. |
| 3. Claude reference fleet | Control plane, MCP, Claude adapter, identity/presence/messages, manager-assigned background-ID capture, down/resume; wind-down refusal for active work, Git operations, leases, checks/measurements, and landing; provider session plus managed-worktree ownership verification before stop; durable final worker status and tracked resume brief; virtualized lifecycle scenarios | Implemented virtually and aligned to installed CLI | Run a bounded live Claude multi-domain task and resume it with owner-approved provider quota. |
| 4. Verification and integration | Exact-SHA checks, FIFO resources, guarded convergence, integration queue, main protection, local bare canonical, reversible forge attachment, delivery-state separation, and read-only doctor evidence for drift count/age, Git operations, runtime availability, and recoverability; `SCN-exact-sha-checks`, `SCN-resource-fifo`, `SCN-safe-convergence`, `SCN-native-integration`, `SCN-local-canonical`, `SCN-forge-migration`, `SCN-delivery-lifecycle`, `SCN-bootstrap-acceptance`, `SCN-worktree-bootstrap` | Implemented locally | Real release/deployment adapters and live receipts remain release-scoped operational qualification. |
| 5. Runtime portability | Claude and Codex capability adapters, mixed plans, invocation-scoped identity-bound MCP on create/resume without global config mutation, parse-compatible safety and resume option ordering, provider-specific runtime-ID capture and durable fallback; `SCN-mixed-runtime`, `SCN-mcp-stdio` | Implemented virtually and aligned to installed CLIs | Run one authorized live mixed Claude/Codex shared-boundary task. |
| 6. Self-hosting | Clean-commit bounded candidate staging, exclusion of arbitrary untracked files, internal dependency-link validation, mode-aware tree hashing, acceptance receipts, side-by-side versions, conflict-safe stable launcher, atomic activation/reconciliation/rollback; self-host scenarios plus an isolated real-checkout build/activation of `6740f33` | Mechanics implemented and temporarily qualified | Install a stable TORCH in the user location and use it to manage/test/promote a later candidate of this checkout. Persistent installation approval required. |
| 7. COMBATRIG re-import | Read-only portable importer and report preserving 33 areas, 570 backlog records, checks/resources/schedules/release boundaries | Analysis implemented; cutover blocked | Owner must resolve 56 scope/exclusion gaps across all 33 areas, then authorize install/operation. |
| 8. Product surface | Redesigned site and dispatch-board story; installed-launcher onboarding; responsive qualification ledger; keyboard-operable command tabs; local read-only Console covering ownership graph, worktree drift, recoverability, acknowledgements, checks, integration, delivery, resources, schedules, decisions, provider health, and context evidence; desktop/mobile Chromium rendering with zero mobile overflow and exercised interactions; `SCN-package-distribution` packs and installs the CLI offline in an isolated consumer | Local surface and standalone artifact implemented and visually qualified | Registry publication and public deployment remain open. |

## Required acceptance-configuration audit

| Spec configuration | Evidence | Determination | Missing proof |
| --- | --- | --- | --- |
| A. Laptop-only | `SCN-bootstrap-acceptance`, `SCN-native-integration`, `SCN-local-canonical`, `SCN-fleet-fresh-resume`, and `SCN-cli-lifecycle-surface` exercise analysis through integration, restart, and detach without a forge or hosted service. | Implemented and virtualized locally | A real Claude or Codex session must complete the same lifecycle before the first usable release is qualified. |
| B. Existing local repository | `SCN-existing-repository-preservation`, `SCN-install-trackability`, and purge safety retain history, branches, prior configuration, and untracked bytes. | Proven locally | None beyond the broader live-release gate. |
| C. Forge-backed | Forge configuration is optional; provider-neutral attach/status/detach logic is covered using a local Git remote. | Implemented locally | A hosted forge is not required for first-release conformance. |
| D. Local to forge-backed | `SCN-forge-migration` attaches an equivalent remote while preserving identities, worktrees, backlog, decisions, and messages. | Proven locally | None beyond any future forge-provider adapter qualification. |
| E. Forge-backed to local | `SCN-forge-migration` detaches the remote and continues local operation. | Proven locally | None. |
| F. Forge outage | `SCN-forge-migration` makes the remote unavailable while local state and operations survive and synchronization risk remains visible. | Proven locally | None. |
| G. Mixed runtimes | `SCN-mixed-runtime`, `SCN-codex-adapter`, `SCN-claude-adapter`, durable messages, and the real stdio MCP handshake prove a shared provider-independent control plane with corrected installed-CLI plans. | Implemented virtually | One authorized live Claude/Codex shared-boundary change must demonstrate actual coordination. |
| H. TORCH builds TORCH | Candidate staging, complete acceptance receipts, stable launcher mechanics, activation, rollback, and isolated real-checkout execution are proven. | Mechanics implemented; exit gate open | An installed stable release must manage development, testing, and promotion of a successor from outside this checkout. |
| I. COMBATRIG compatibility | The read-only import preserves 33 areas, 570 backlog records, prompts, checks, resources, schedules, and authority while refusing 56 unresolved boundary gaps. | Analysis implemented; exit gate open | The owner must resolve boundaries and authorize TORCH installation and operation in COMBATRIG without core special cases. |

The definition-of-first-usable-release sequence therefore remains unproven as
an end-to-end live lifecycle even though each local mechanism has scenario
coverage. In particular, passing virtualized runtime scenarios is not evidence
that a provider session completed real work, and an isolated activated
candidate is not evidence that installed stable TORCH manages this checkout.

## Cross-cutting requirements

### Project-specific startup

`torch bootstrap` produces a provider-independent brief from the selected Git
repository and optional external specs. `torch architect plan` previews
provider, model, isolation, schema, prompt size, and budget without calling a
model. `torch architect run` requires explicit quota authorization and returns
a still-pending proposal. Semantic validation rejects changed provenance,
invented ownership/evidence/checks/resources/runtimes/schedules, and model
self-approval.

This is the intended general mechanism: TORCH does not copy COMBATRIG's roster.

### Dynamic fleet evolution

The Session Manager is prompted at startup and after recurring boundary
friction to call `torch_assess_fleet_evolution` (or `torch fleet assess`). This
read-only, manager-only assessment collects active backlog, repeated unowned
path handoffs, recurring multi-domain work, coordination requests, and pending
Fleet changes. It can recommend considering a new domain, but it neither
creates a proposal nor treats its threshold as an architectural decision.

After inspecting repository evidence and coordination cost, the Session
Manager can propose an evidence-backed domain through `torch_propose_domain`
or `torch fleet propose`. The proposal records recurring work, expected
context-locality benefit, and coordination cost. Workers cannot assess or
propose; the owner separately approves; activation commits configuration,
prompt, roster and manifest state, creates a branch/worktree, refreshes the
existing control plane, and permits starting only the new identity. Runtime
start remains a separate explicit provider-quota action.

The Session Manager can also propose retirement through
`torch_propose_domain_retirement` or `torch fleet propose-retirement`.
Retirement is owner-gated and refuses a live session, dirty or uniquely ahead
worktree, active Git guard, resource lease, integration request, active backlog
assignment, stale main, or removal of the last development domain. Safe
retirement removes the worktree and active identity while preserving the Git
branch and a durable retirement record.

The Session Manager can now propose domain merges and splits through CLI and
identity-bound MCP surfaces. TORCH validates exact source ownership coverage,
future runtimes/checks/resources/neighbours, unaffected-domain collisions,
repository head, and tracked configuration digest. The owner can approve or
reject the durable proposal, but approval cannot activate it: TORCH always
returns a `manual-boundary-redesign-required` blocker until a separate workflow
can prove backlog, branch, prompt, worktree, neighbour, and ownership migration
safety. This makes organizational evolution reviewable without pretending a
dangerous automatic rewrite is safe.

### Context locality

Persistent identities and domain worktrees support focused working sets.
Telemetry records measured and estimated evidence separately by identity,
including cached/uncached input, cache creation/read, compactions, resumed
prompt size, cost, task/commit, and verified outcomes. No cache-savings claim
is made without live comparative measurements.

### Scheduling

Machine-readable session/system schedules, authority, retry, failure reporting,
and durable run evidence are implemented. Session schedules require a live
Session Manager; mutating actions require explicit approval. An owner-approved
user-systemd launcher can install manifest-owned service/timer units, dispatch
due cron or interval schedules without duplicate minute runs, refuse tracked
configuration drift, and remove only unchanged TORCH-owned units. The code is
fixture-tested; it has not been installed or qualified persistently on this
machine.

### Release and deployment separation

TORCH persists `implemented -> verified -> integrated -> release-ready ->
released -> deployed -> live-verified` as distinct states. Exact-commit check
receipts and landed integration records are enforced before release readiness.
The Session Manager's integration authority does not grant release or deploy
authority: those transitions default to `owner`, require explicit approval,
and require a configured adapter whose declared capability returns a durable
successful receipt. New installations use `none` for both provider slots. The
complete lifecycle is fixture-tested through the public CLI/service boundary;
no real artifact was published and nothing was deployed.

## Installed runtime CLI contract audit

Read-only/local parser probes were run against `codex-cli 0.157.1` and Claude
Code `2.1.281`. No model turn completed and no provider result was requested.
The audit found two defects and `d8ab841` corrected both:

- Codex accepts `--approve-for-me`, and that option already selects the
  workspace-write sandbox. TORCH no longer combines it with the mutually
  exclusive `--sandbox workspace-write` option.
- `codex exec resume` does not accept `--cd`, `--sandbox`, or
  `--approve-for-me` after the `resume` subcommand. Repository, safety, and MCP
  options must precede `exec`; TORCH now places resume-specific options after
  `resume`.
- A parser-only probe confirmed that
  `codex --cd <worktree> --approve-for-me <MCP config> exec resume --json ...`
  reaches repository trust validation, while the rejected pre-fix ordering
  fails during argument parsing.
- Claude supports `--append-system-prompt-file`, `--bg`, `agents --json`, and
  `stop <id>`. However, Claude explicitly warns that `--bg` manages the
  session ID and ignores `--session-id`. TORCH now omits that flag for
  background creation and accepts only the sole safe ID printed by Claude.
- A sandboxed Claude background-manager startup probe failed before a session
  launched because it could not bind its local control socket. This is not live
  provider qualification and did not justify retrying outside the sandbox.

The virtualized adapter, bootstrap, and lifecycle tests were corrected under
the Test Integrity protocol. They now reject the obsolete command shapes,
ambiguous Claude output, and synthetic background UUID behavior. This proves
local command construction, not a completed provider turn.

## Approval-bound qualification plan

These actions are deliberately not performed by the local build:

1. **Provider quota:** run one bounded Session Architect call, then a small live
   Claude/Codex fleet task with a fixed budget and no deployment authority.
2. **Persistent installation:** install the current accepted TORCH version
   under user-local versioned state and let it manage this repository from
   outside the source tree.
3. **COMBATRIG mutation:** review the generated ownership gaps before creating
   any `.torch` state or worktrees there.
4. **System scheduler:** install/enable the implemented user service/timer only
   with explicit approval, then verify its first real dispatch and reversal.
5. **Remote/public state:** push branches, publish a package, or deploy the site
   only under explicit release scope.

## Next qualification order

1. owner-authorized bounded Session Architect and live mixed-provider run;
2. owner-authorized stable self-host and system-scheduler qualification;
3. owner review of COMBATRIG gaps and a separately authorized cutover trial;
4. release-scoped package publication and public website deployment.
