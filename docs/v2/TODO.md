# TORCH 2.0 roadmap and status

Updated: 2026-08-04. Branch: `v2/development-network` (all v2 work lives here; TORCH `main` is
untouched). BitUnlock work is trunk-based on its `main` — see "Standing decisions" below.

This is the executable roadmap for the TORCH 2.0 Development Network effort. Work in dependency
order. Check an item only after its verification gate passes.

## Authoritative documents (reading order)

1. [`DEVELOPMENT_NETWORK_SPEC.md`](./DEVELOPMENT_NETWORK_SPEC.md) — product vision, v0.2.
2. [`V2_ARCHITECTURE_BRIDGE.md`](./V2_ARCHITECTURE_BRIDGE.md) — what TORCH 1.x and BitUnlock
   actually provide, verified against both codebases 2026-08-03.
3. [`INCREMENTAL_DEV_PLAN.md`](./INCREMENTAL_DEV_PLAN.md) — cross-repo staged plan with the
   18-row increment table. The **pilot is the go/no-go checkpoint**; everything after it is
   justified only by what the pilot proves.
4. BitUnlock `docs/TORCH_INTEGRATION_PLAN.md` (on bitunlock `main`) — BitUnlock-side view.

## Done

- [x] **Spec v0.1 → v0.2** — three modes (Stewardship / Build / Foundry), custody-minimized
      funding, then the seven code-reality corrections folded in (commits `f0aae3c`, `1878e99`).
- [x] **Architecture bridge** — 1.x seams and BitUnlock extension surface mapped; spec
      corrections derived (`176ef65`).
- [x] **Incremental dev plan** — both repos, additive-only BitUnlock changes, staged increments
      (`32ca0df`); BitUnlock-side plan merged to bitunlock `main` (`7fd36bc`).
- [x] **T0.1** — spec v0.2 pass (`1878e99`).
- [x] **T0.2** — six contract schemas (campaign, milestone, task-contract, pledge,
      evidence-bundle, stewardship-manifest) with fixtures, dependency-free validator, and CI
      wiring (`validate:v2` in `npm test`; suite green at 394 tests) (`70c7819`).

## ⚠️ Owner action items — only you can do these

1. **B0.2 — decide BitUnlock's license.** BitUnlock is "all rights reserved" with unpublished
   `@bitunlock/protocol` / `@bitunlock/sdk` packages. TORCH must vendor them (BitRoad precedent)
   and intends to be open source. This blocks any public TORCH 2.0 release that touches the SDK.
   A vendoring grant for the two packages is the minimum viable decision.
2. **B0.1 — onboard TORCH on BitUnlock staging.** Generate a TORCH service keypair (store the
   nsec like you store `SERVICE_NSEC`), allowlist the npub, create the tenant, connect a wallet,
   register a throwaway static product, run one fake order end to end. Stand up the sandbox
   Worker so TORCH CI can exercise checkout.
3. **Pick the pilot.** One opted-in repo (one of your own is fine), one bounded Stewardship
   scope, and who plays sponsor. The pilot can run with you in every human role — that validates
   the machinery; an external party validates the product.
4. **BitUnlock's own owner items still come first** (its `docs/TODO.md`): back up and
   recovery-test `SERVICE_NSEC` + KEK versions, rotate the exposed credentials, watch the first
   fee settlement (~1000-sat threshold — TORCH coordination fees on accrual billing will likely
   be what trips it). These matter *more* once a second tenant's revenue depends on the same
   service identity.

## Next implementation step

**T0.3 — additive lock-event fields.** Optional `campaignId`, `milestoneId`, `taskContractHash`,
`leaseId`, `actor` in lock content JSON plus the v2 d-tag grammar, flowing through the real lock
code. Gate: existing suite untouched and green; new round-trip tests; a 1.x-only scheduler run
behaves byte-identically. Then, in order: T0.4 (signed evidence bundle emitted by a real
scheduler run), T0.5 (durable actor identity), T1.1 (campaign service skeleton — Worker + D1,
copying BitUnlock's NIP-98/idempotency patterns), T1.2 (fee products + entitlement-gated
reports), T1.3 (**pilot**).

## Remaining roadmap (see INCREMENTAL_DEV_PLAN.md for full detail)

- [ ] T0.3 additive lock-event fields + d-tag grammar
- [ ] T0.4 evidence bundle emitted and hash-published by a real run
- [ ] T0.5 durable actor identity (two-key model: ephemeral locks, durable npubs)
- [ ] B0.1 staging tenant + sandbox (owner)
- [ ] B0.2 license decision (owner)
- [ ] T1.1 campaign service skeleton
- [ ] T1.2 coordination-fee static products + offline entitlement verification
- [ ] T1.3 pilot campaign — **go/no-go checkpoint**
- [ ] B2.1 BitUnlock webhooks (first BitUnlock code change; after its P1 gates are green)
- [ ] B2.2 payer/beneficiary separation (known-beneficiary mode)
- [ ] T2.x Build campaigns (feature contracts, milestone DAG, pledges)
- [ ] Custody design pass (gates all of Stage 3)
- [ ] B3.1 allowance ledger + B3.2 machine delegation; T3.1 provider gateway
- [ ] Stage 4 (multi-payer funding, adjustments, subscriptions, third payment role) — legal
      review first; possibly never needed

## Standing decisions (don't relitigate without new facts)

- **BitUnlock is trunk-based.** Short-lived branches into `main`, deploy to prod with the new
  capability off, grant to the TORCH tenant only, observe. No long-lived v2 branch there. The
  one absolute exception: **D1 migrations** are rehearsed on staging first, always additive,
  never edited after commit.
- **All BitUnlock changes are additive and capability-gated, default off.** Off = today's exact
  behavior. Rollback = flip the flag. Satisfied and BitRoad must never notice.
- **Phase A is Mode A only.** TORCH holds no provider credential of any kind; sponsors put
  spend-limited keys directly into the runner environment. Mode B (gateway-held Routstr
  sessions) waits for a durable-custody design review per the Cashu post-mortem.
- **Fees are milestone-grained, never per-task** (BitUnlock 10-sat floor + invoice overhead; no
  micro-fee rail exists). Coordination fee and verification reserve are separate static
  products, not splits.
- **Pledges are signed Nostr events, never money.** BitUnlock has no holds or escrow.
- **Order tracking is polling** until B2.1, and polling remains the reconciliation authority
  even after webhooks exist.

## Important to know

- **The frozen surfaces in BitUnlock are load-bearing**: `PAYMENT_ROLES` is two roles by design,
  refunds/escrow are explicitly rejected, and the execution schema registry is hardcoded. The
  plan works *with* these, not around them; anything that seems to need them broken belongs in
  Stage 4 or nowhere.
- **The stewardship manifest is independently shippable.** `stewardship-manifest-v1` is the
  public `ai-contributions` format any repo can adopt with zero TORCH machinery — the cheapest
  credibility/demand test available, publishable before any platform exists.
- **TORCH 1.x hygiene debt** (not blocking, but real): root clutter violating its own AGENTS.md
  (test_output*.txt, PNGs, leftover test dirs), checked-in `dashboard/app.js.rej/.orig/.diff`
  from a failed patch, ~534 stale `agents/daily/*` remote branches, and an unused Postgres
  migration. Worth a cleanup task before the campaign service work starts building on this repo.
- **Maintainer attention is priced into milestones deliberately** — if reviewing TORCH output is
  unpaid, the best maintainers opt out. Keep a maintainer-review line in milestone budgets when
  designing T1.2 products.
