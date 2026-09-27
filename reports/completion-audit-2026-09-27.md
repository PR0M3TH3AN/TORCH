# TORCH portable-agent-fleet completion audit

Date: 2026-09-27  
Branch: `rewrite/portable-agent-fleet`  
Audited specification: `docs/PORTABLE_AGENT_FLEET_SPEC.md`  
Latest audited implementation commit: `5a06deb`

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
are now owner-authorized operational qualification:

1. owner-authorized installation and live qualification of the implemented
   persistent user-systemd schedule launcher;
2. owner-authorized live Claude/Codex coordination and resume evidence;
3. an installed stable TORCH managing this source checkout;
4. owner resolution of COMBATRIG's 56 blocking ownership/exclusion gaps,
   followed by an authorized cutover trial;
5. package publication and public website deployment.

Passing local tests do not close any live/provider/install/deployment gate.

## Evidence baseline

- `npm test`: **59/59 PASS** against the tree committed as `5a06deb`.
- `npm run lint`: **PASS**.
- `npm run check`: **PASS**.
- `git diff --check`: **PASS**.
- No live AI provider was called.
- No stable version, system service, timer, COMBATRIG state, remote branch, or
  public deployment was changed.
- The pre-existing untracked `test-torch-config-host-uQKdqL/` fixture remains
  untouched and untracked.

## Delivery-stage matrix

| Stage | Current evidence | Status | Exit-gate work |
| --- | --- | --- | --- |
| 0. Preserve and specify | Legacy branches `legacy/nostr-torch` and `legacy/development-network-v2`; rewrite branch; canonical spec and scenario inventory | Implemented locally | Owner product-boundary approval is represented by continuing this rewrite; no remote push was performed. |
| 1. Portable kernel | `src/kernel/`; strict `torch.dev/v1alpha1` validation in `src/kernel/config.mjs`; install/doctor/uninstall/worktree scenarios | Implemented locally | A future schema needs an actual migration transform; unknown versions currently fail closed with an explicit migration blocker. |
| 2. Project decomposition | Repo/spec analysis, architecture graph, pending proposal, Session Architect brief and guarded Claude/Codex planner; `SCN-domain-collision`, `SCN-spec-fleet-design`, `SCN-ai-fleet-bootstrap`, `SCN-ai-fleet-planning`, `SCN-bootstrap-acceptance` | Implemented locally | Live runtime qualification remains in Stages 3 and 5. |
| 3. Claude reference fleet | Control plane, MCP, Claude adapter, identity/presence/messages, capture/down/resume; virtualized lifecycle scenarios | Implemented virtually | Run a bounded live Claude multi-domain task and resume it with owner-approved provider quota. |
| 4. Verification and integration | Exact-SHA checks, FIFO resources, guarded convergence, integration queue, main protection, local bare canonical, reversible forge attachment, and delivery-state separation; `SCN-exact-sha-checks`, `SCN-resource-fifo`, `SCN-safe-convergence`, `SCN-native-integration`, `SCN-local-canonical`, `SCN-forge-migration`, `SCN-delivery-lifecycle`, `SCN-bootstrap-acceptance` | Implemented locally | Real release/deployment adapters and live receipts remain release-scoped operational qualification. |
| 5. Runtime portability | Claude and Codex capability adapters, mixed plans, MCP/CLI parity, runtime-ID capture and durable fallback; `SCN-mixed-runtime` | Implemented virtually | Run one live mixed Claude/Codex shared-boundary task. |
| 6. Self-hosting | Candidate isolation, acceptance receipts, side-by-side versions, atomic activation/reconciliation/rollback; self-host scenarios | Mechanics implemented | Install a stable TORCH outside this checkout and use it to manage/test/promote a candidate of this checkout. Persistent installation approval required. |
| 7. COMBATRIG re-import | Read-only portable importer and report preserving 33 areas, 570 backlog records, checks/resources/schedules/release boundaries | Analysis implemented; cutover blocked | Owner must resolve 56 scope/exclusion gaps across all 33 areas, then authorize install/operation. |
| 8. Product surface | Redesigned site, dispatch-board story, local read-only Console and Fleet-change ledger; desktop/mobile local rendering; `SCN-package-distribution` packs and installs the CLI offline in an isolated consumer | Local surface and standalone artifact implemented | Registry publication and public deployment remain open. |

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

The Session Manager can propose an evidence-backed domain through
`torch_propose_domain` or `torch fleet propose`. The proposal records recurring
work, expected context-locality benefit, and coordination cost. Workers cannot
propose; the owner separately approves; activation commits configuration,
prompt, roster and manifest state, creates a branch/worktree, refreshes the
existing control plane, and permits starting only the new identity.

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
