# TORCH 2.0 × BitUnlock — Incremental Development Plan

**Status:** Draft v0.1
**Canonical for:** cross-repo sequencing of TORCH 2.0 and the BitUnlock changes it needs.
**Companions:** [`DEVELOPMENT_NETWORK_SPEC.md`](./DEVELOPMENT_NETWORK_SPEC.md) (product vision), [`V2_ARCHITECTURE_BRIDGE.md`](./V2_ARCHITECTURE_BRIDGE.md) (verified terrain), BitUnlock `docs/TORCH_INTEGRATION_PLAN.md` (BitUnlock-side engineering view).

## 0. Governing rules

1. **BitUnlock upgrades are allowed but must never break existing tenants** (Satisfied, BitRoad) or the published contract. Every BitUnlock change in this plan is additive: new tables via append-only migrations, new endpoints marked in OpenAPI, new behavior behind per-tenant capabilities that default **off**. Turning a capability off must restore exactly today's behavior.
2. **TORCH promotes BitUnlock's existing backlog; it does not invent parallel systems.** Everything TORCH needs from BitUnlock already exists as a designed item in BitUnlock's `docs/FUTURE_APPLICATION_PERMISSION_ROADMAP.md`. That document's promotion criteria (§17) require a second application class and an independently versioned reference consumer — TORCH is both. We activate items in TORCH-need order, not roadmap-tier order.
3. **TORCH work must not displace BitUnlock's own stabilization work.** BitUnlock's `docs/TODO.md` Priority 0–1 items (production reconciliation, backup/recovery, GA gates) and the owner action items proceed independently. No stage below requires pausing them; Stage 2+ BitUnlock items should land only after Priority 1 gates are green.
4. **Every increment is a safe stopping point.** If work halts after any increment, both products remain shippable and no tenant is broken.
5. **Custody rules from the spec bind every increment.** TORCH holds no compute principal in Stages 0–2. Any increment that would put a bearer credential under TORCH control (Stage 3) requires a durable-custody design pass first — the standing lesson from BitUnlock's Cashu post-mortem (`docs/CASHU_MICROPAYMENTS_PLAN.md` §8a).

## 1. Stage map

```text
Stage 0  Foundations            TORCH docs/schemas; BitUnlock untouched (operator actions only)
Stage 1  Pilot (spec Phase A)   TORCH campaign service + static products; BitUnlock code unchanged
Stage 2  Notifications+Sponsors Webhooks, payer/beneficiary; TORCH Build campaigns
Stage 3  Compute leases         Allowance ledger, machine delegation; TORCH provider gateway
Stage 4  Scale economics        Multi-payer funding, adjustments, subscriptions; Foundry
```

Each stage's BitUnlock items map to `FUTURE_APPLICATION_PERMISSION_ROADMAP.md` sections, cited as FR §n.

---

## Stage 0 — Foundations (TORCH-only; BitUnlock operator/owner actions only)

No BitUnlock code changes. TORCH work is docs + schemas + additive lock-protocol fields.

### T0.1 Spec v0.2
Fold the bridge's §4.5 corrections into `DEVELOPMENT_NETWORK_SPEC.md`: milestone-grained fees, pledges as TORCH-side signed events, poll-driven order tracking, refunds scoped to provider layer, Mode D deferred to Stage 4, Mode A-only compute for the pilot.
**Exit:** spec and bridge contain no contradictions.

### T0.2 v2 object schemas
JSON Schemas under `docs/v2/schemas/`: `campaign`, `milestone`, `task-contract`, `pledge`, `evidence-bundle`, `stewardship-manifest` (the public `ai-contributions` manifest). Wire into CI beside the existing scheduler contract validators (`npm run validate:scheduler` pattern).
**Exit:** schemas validate in CI; example instances committed as fixtures.

### T0.3 Additive lock-event fields
Optional `campaignId`, `milestoneId`, `taskContractHash`, `leaseId`, `actor` in lock content JSON plus the v2 d-tag grammar. 1.x events without these fields remain fully valid.
**Exit:** existing test suite green untouched; new round-trip tests for v2 fields; a 1.x-only scheduler run behaves identically.

### T0.4 Evidence bundle v1
Normalize `verify-run-artifacts.mjs` output + task-log into one signed JSON document conforming to the T0.2 schema; publish its hash as a Nostr event via the existing quorum publisher.
**Exit:** a normal scheduler run emits a verifiable signed bundle; verification CLI (`torch-lock verify-evidence`) validates signature + schema + hash.

### T0.5 Durable actor identity
Two-key model from the bridge §6.1: locks stay ephemeral, but carry an `actor` npub with a signature over the lock's d-tag. Actor registry document format for maintainer/sponsor/verifier/worker roles.
**Exit:** attribution verifiable from relay data alone.

### B0.1 (operator) TORCH tenant on staging
Allowlist a TORCH service pubkey on BitUnlock **staging**; create tenant, connect wallet, register a throwaway static product; run one fake order end to end. Stand up the sandbox Worker for TORCH CI use.
**Exit:** TORCH CI can exercise a full quote→pay→unlock against the sandbox.

### B0.2 (owner) License decision
BitUnlock has no license ("all rights reserved"), and `@bitunlock/protocol`/`@bitunlock/sdk` are unpublished — TORCH must vendor them the way BitRoad does. Decide BitUnlock's license (or at minimum a vendoring grant for the two packages) **before** TORCH 2.0 code that imports them is published.
**Exit:** recorded decision; TORCH vendoring is legally clean.

---

## Stage 1 — Pilot (spec Phase A; BitUnlock code unchanged)

TORCH becomes a real BitUnlock tenant selling static products. Polling only. Mode A compute only (sponsor-created spend-limited provider keys that TORCH never touches).

### T1.1 Campaign service skeleton
New service (recommended: Cloudflare Worker + D1, copying BitUnlock's NIP-98/idempotency/tenant-scoping patterns — same operator, same stack). Owns: campaigns, milestones, task contracts, pledge registry, evidence index, BitUnlock order polling. Publishes signal events to relays; repo-side scheduler talks to it over REST + NIP-98.
**Exit:** CRUD + state machine tested; poll loop reconciles sandbox orders.

### T1.2 Coordination fee as static product
One BitUnlock static product per milestone coordination fee (json payload = signed milestone receipt); verification reserve as a second product; private report access via term-access entitlements verified **offline** with the vendored SDK.
**Exit:** paying the product on staging flips the milestone's funding state in the campaign service via polling; report endpoint honors entitlements.

### T1.3 The pilot (spec §24)
One opted-in repo, one Stewardship campaign, sponsor-supplied limited OpenRouter key configured directly into the runner environment, TORCH-operated worker, one independent verifier, coordination fee paid through BitUnlock **production** (operator allowlists the TORCH tenant on prod), public cost/outcome summary.
**Exit criteria (from the spec):** maintainer accepts the result; compute stayed within the sponsor limit; TORCH held no principal; review cost the maintainer less than doing the coordination manually. Even a pilot where the operator plays all human roles counts for the machinery; a pilot with one external party counts for the product.

**BitUnlock during Stage 1:** zero code changes. Operator actions: prod allowlist; optionally `single-recipient` + `accrual` billing for the TORCH tenant (existing, capability-gated, already exercised in production by the fee ledger).

---

## Stage 2 — Notifications and sponsor flows (spec Phase B)

First BitUnlock code changes. Both are FR Tier 1 items whose promotion criteria TORCH now satisfies. Land only after BitUnlock Priority 1 gates are green.

### B2.1 Signed lifecycle events + webhooks (FR §4)
As specified in FR §4: common signed envelope; transports = signed HTTPS webhooks + encrypted Nostr events, with **polling preserved forever as fallback** (so no existing tenant must change). Event set for the first cut: `order.created`, `order.paid`, `entitlement.issued`, `entitlement.revoked`, `execution.completed`, `execution.failed`.
**Compat:** new tables (append-only migrations); per-tenant opt-in endpoint registration; no payload contains credentials or entitlement plaintext; OpenAPI routes added as new; conformance vectors extended, none modified.
**Tests:** delivery/retry/replay-window/dead-letter negative vectors; regression run of Satisfied + BitRoad flows with the capability off *and* on-but-unregistered.
**Exit:** TORCH campaign service consumes webhooks with polling fallback (T2.1); no behavior change for tenants that never register an endpoint.

### B2.2 Payer/beneficiary separation (FR §6)
Mode 1 first (known beneficiary): sponsor pubkey pays; entitlement issues to a named beneficiary (maintainer, verifier, or the campaign service itself). Private claims (mode 2) deferred until entitlement recovery is stable, per BitUnlock's own sequencing note.
**Compat:** absent a `beneficiaryPubkey`, behavior is byte-identical to today (payer = beneficiary). Capability-gated per tenant; new schema fields optional.
**Exit:** a sponsor can fund a milestone product whose entitlement lands with the campaign or maintainer; negative vectors for wrong-beneficiary redemption.

### T2.1 Webhook consumption + reconciliation
Campaign service prefers webhooks, reconciles by polling, and treats poll state as authoritative on conflict.

### T2.2 Build-campaign machinery
Feature contracts (signed, versioned via the existing prompt-governance service), milestone DAG replacing roster round-robin for campaign work (1.x roster mode remains untouched for maintenance fleets), pledge lifecycle (signed pledge events → JIT settlement prompts when a milestone goes ready), sponsor/maintainer notification digests.
**Exit:** one small Build campaign (spec §24 example: bounded export feature) runs end to end on staging rails.

---

## Stage 3 — Compute leases (spec Phase C; the custody-sensitive stage)

Gate: written custody design for every bearer credential TORCH's gateway will hold, reviewed against the Cashu post-mortem criteria (durable custody first-class; fee economics per rail) **before** implementation.

### B3.1 Generic usage/allowance ledger (FR §3)
An entitlement grants N units ("inference-sats", "tokens", "verifier-runs"); idempotent, concurrency-safe consumption API with signed usage receipts; rail-agnostic (Lightning-funded now, Cashu-fundable later if ever revisited). This is the BitUnlock-side representation of the spec's **compute lease**.
**Compat:** entirely new subsystem; existing entitlements gain nothing unless a product opts in. Capability-gated.
**Exit:** overspend impossible under concurrent consumption (adversarial test); TORCH can reconcile gateway metering against ledger receipts.

### B3.2 Machine/service-account delegation (FR §8)
Worker-agent keys consume allowances under a grant bound to owner, machine pubkey, allowed operations, allowance, expiry, revocation. Independently revocable; never inherits billing or tenant admin.
**Compat:** additive; no existing auth path changes.

### T3.1 Provider gateway
TORCH-side OpenAI-compatible proxy that meters tokens against a lease/allowance, kills at ceiling, reconciles usage, and handles credential injection/revocation for Mode B (ephemeral Routstr sessions). This is where the Stage 3 custody gate applies.

### T3.2 Verification depth
Blind verifier assignment on independent leases; human-testing task flows; evidence-bundle cross-verification.

### B3.3 (optional) TORCH execution schemas
Only if TORCH sells execution products: register TORCH input/output schemas in BitUnlock's validator registry and, if needed, a campaign-service adapter beside `routstr-adapter.ts`. Skip if static products + TORCH's own gateway cover the need — fewer moving parts in BitUnlock.

---

## Stage 4 — Scale economics (spec Phases D/E; Foundry)

Highest-complexity BitUnlock items; each needs the legal review the spec (§21) and FR Tier 3 both call for.

### B4.1 Multi-payer funding / group unlocks (FR §13)
Many sponsors contribute toward one milestone target with defined partial-funding and target-failure behavior. This is the custody-minimized replacement for the spec's Mode F campaign reserve — contributions are tracked by BitUnlock as order-shaped facts, not pooled in a TORCH wallet.
**Gate:** legal/regulatory review first (FR §13 lists it; spec §21 requires it).

### B4.2 Adjustment/credit artifacts (FR §11)
Signed refund/credit/compensation artifacts referencing original orders — gives the spec's "unused value returns" language an auditable form without moving BitUnlock into escrow.

### B4.3 Subscription transformations (FR §5)
Maintainer subscriptions with upgrades/supersession, after manual renewal is proven.

### B4.4 Third payment role (spec Mode D)
Only if Stages 1–3 prove per-milestone single-leg + accrual insufficient. This is the one item that is a true protocol version change (`PAYMENT_ROLES` is frozen); it stays last and may never be needed.

### T4.x Foundry
Charters, exploration milestones, competing prototypes, graduation — pure TORCH-side product work on the machinery Stages 1–3 built.

---

## 2. Cross-cutting compatibility discipline (every BitUnlock increment)

Inherited from BitUnlock's `AGENTS.md` and existing practice; restated here as the plan's contract:

- Append-only migrations; never edit a committed migration.
- Capability-gated, default-off; off = today's exact behavior.
- Clients must stay leg-count-agnostic (already mandated); nothing here changes leg semantics until B4.4, which is version-negotiated.
- OpenAPI updated in the same change; `documentation-truth` tests updated; conformance `test-vectors/` extended, never modified.
- Regression gate per increment: full `npm run check`, plus a named Satisfied execution-product run and a BitRoad conformance byte-diff, with the new capability off and on.
- Staging soak before prod; prod capability grants initially to the TORCH tenant only.
- Rollback story per increment = flip the capability off (data remains, behavior reverts).

## 3. Sequencing summary

| Order | Increment | Repo | Blocked by |
|---|---|---|---|
| 1 | T0.1 spec v0.2 | TORCH | — |
| 2 | T0.2 schemas | TORCH | T0.1 |
| 3 | T0.3 lock fields | TORCH | T0.2 |
| 4 | T0.4 evidence bundle | TORCH | T0.2 |
| 5 | T0.5 actor identity | TORCH | T0.3 |
| 6 | B0.1 staging tenant + sandbox | BitUnlock (operator) | — |
| 7 | B0.2 license decision | BitUnlock (owner) | — |
| 8 | T1.1 campaign service | TORCH | T0.2, B0.1 |
| 9 | T1.2 fee products + entitlement gating | TORCH | T1.1 |
| 10 | T1.3 **pilot** | both (operator) | T0.4, T1.2 |
| 11 | B2.1 webhooks | BitUnlock | BitUnlock P1 gates; pilot learnings |
| 12 | B2.2 payer/beneficiary | BitUnlock | B2.1 recommended, not required |
| 13 | T2.1–T2.2 Build campaigns | TORCH | T1.3, B2.1 |
| 14 | custody design pass | TORCH doc | — (gates Stage 3) |
| 15 | B3.1 allowance ledger | BitUnlock | B2.1 |
| 16 | B3.2 machine delegation | BitUnlock | B3.1 |
| 17 | T3.1 provider gateway | TORCH | 14, B3.1 |
| 18 | Stage 4 items | both | legal review; proven need |

The pilot (row 10) is the go/no-go checkpoint: everything after it is justified only by what the pilot proves about demand and maintainer-attention economics.
