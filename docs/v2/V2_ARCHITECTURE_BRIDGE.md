# TORCH 2.0 Architecture Bridge

**Status:** Draft v0.1
**Companion to:** [`DEVELOPMENT_NETWORK_SPEC.md`](./DEVELOPMENT_NETWORK_SPEC.md)
**Purpose:** Map what TORCH 1.x and BitUnlock actually implement today onto what the Development Network spec requires, so that v2 work builds on verified seams instead of assumptions.

The spec describes the destination. This document describes the terrain. Where the two disagree, this document wins on facts and the spec wins on intent.

---

## 1. Reading Order

1. `DEVELOPMENT_NETWORK_SPEC.md` — the product vision (Stewardship / Build / Foundry, custody-minimized funding).
2. This document — what exists, what is missing, what the spec must revise.
3. `../TORCH_EVOLUTION_CONCEPT.md` — an earlier, orthogonal sketch (roster → DAG workflow orchestration). It answered "how should agents flow"; the v2 spec answers "who pays and why." The DAG idea survives as the orchestration layer *inside* v2 milestones (§6 of the spec); it is not a competing direction.

---

## 2. What TORCH 1.x Actually Provides

TORCH 1.x is a Nostr task-locking toolkit (~15k LOC first-party JS, ESM, Node ≥22, two runtime deps: `nostr-tools`, `ws`) plus a prompt-driven scheduler that has been running a real multi-agent maintenance fleet against this repo (500+ merged agent branches). The v2-relevant assets:

### 2.1 Lock protocol (reusable as-is, extend the payload)

A lock is a kind-30078 parameterized-replaceable event (`src/lib.mjs:165-200`) with:

- `d` tag: `<namespace>-lock/<cadence>/<agent>/<date>`
- NIP-40 expiration (TTL default 7200s)
- Content JSON that **already carries provenance**: `gitCommit`, `promptPath`, `promptHash` (sha256 of the prompt file), `platform`, `model`.

Race resolution is publish-then-recheck with earliest `(created_at, eventId)` winning. Completion is a permanent replacement event with no expiration.

**v2 relevance:** the content JSON and tag set can carry `campaignId`, `milestoneId`, `taskContractHash`, and `leaseId` without changing the event kind or the race algorithm. The provenance fields are the seed of the spec's "compiled prompt bundle digest" (spec §8).

### 2.2 Scheduler as sole completion authority (the enforcement point)

`scripts/agent/run-scheduler-cycle.mjs` (826 lines, 19-step lifecycle) enforces two invariants v2 must preserve:

1. **Only the scheduler calls `lock:complete`.**
2. **The durable task-log is written only after completion publishes.**

Gates already in the path before completion: prompt-file validation → memory-evidence verification → run-artifact verification (`scripts/agent/verify-run-artifacts.mjs`, content-structure checks on CONTEXT/TODO/DECISIONS/TEST_LOG artifacts) → configurable validation commands → relay publish.

**v2 relevance:** a compute-lease budget check and a settlement/evidence-bundle step slot in between the validation gate and `lock:complete`. This is where "task complete" becomes "task complete, within budget, with evidence."

### 2.3 The single execution seam

`scripts/agent/run-selected-prompt.mjs` is the **only** place a worker process is spawned (`codex exec`, `claude -p`, or arbitrary `SCHEDULER_AGENT_RUNNER_COMMAND`). Every v2 runtime concern — sandboxing, provider-gateway routing, token metering against a lease, credential injection and revocation — attaches at this one seam.

### 2.4 Verification and anti-reward-hacking policy

- `AGENTS.md` is already a working "safety constitution": validation replaces review, tests may not be weakened, test-touching changes require a machine-readable `test_integrity_note`. This is layer 1 of the spec's prompt-authority hierarchy (spec §8), already field-tested.
- Prompt governance exists: `src/services/governance/index.js` implements propose → validate → apply/reject with git-backed versioning and rollback. This is the precursor of signed feature contracts and role-prompt versioning.

### 2.5 Production-grade relay plumbing

Quorum publishing with retry/backoff and error classification (`src/lock-publisher.mjs`, `src/lock-error-classifier.mjs`), tiered relay fallback, health scoring with quarantine (`src/relay-health-manager.mjs`), and a publish/read deep probe. v2's campaign/pledge/evidence events inherit all of it.

### 2.6 Dashboard

Serverless read-only lock viewer (`dashboard/app.js`, vanilla ES modules, direct relay WebSockets). Extensible into the campaign board: campaigns/milestones/pledges are just more addressable events to subscribe to.

---

## 3. What the Spec Needs That 1.x Does Not Have

| Spec concept | 1.x state | Gap class |
|---|---|---|
| Durable identity (maintainers, sponsors, verifiers, workers) | **None** — every lock uses a throwaway keypair generated at claim time | New subsystem |
| Campaigns, milestones, feature contracts | Nothing | New subsystem |
| Dependency-aware orchestration (milestone DAG) | Flat `roster.json`, round-robin | Replace scheduler's selection layer |
| Compute leases / budget enforcement | Nothing — workers spend whatever their CLI account allows | New subsystem at the §2.3 seam |
| Evidence bundles | Precursor only: run artifacts + task-logs are structured but local-only and not signed | Extend + sign + publish |
| Payments, fees, ledger | **Zero code** — no Lightning, zap, wallet, escrow, or bounty code anywhere | Delegated to BitUnlock (§4) + new TORCH ledger |
| Multi-project operation | Single-repo: TORCH installs *into* one host repo and coordinates only it | Architectural decision (§6.3) |
| Datastore | Filesystem + relays only; one unused Postgres migration (`migrations/create_memories_table.sql`) | New subsystem |
| Independent verification (blind verifiers) | Validation commands run locally by the same scheduler | New subsystem |
| Managed branch/PR flow | Emergent — agent CLIs create branches per their prompts; nothing in-repo manages them (534 orphaned `agents/daily/*` branches prove it) | New subsystem |

The pattern: **1.x has the coordination and enforcement skeleton; it has none of the economic or identity organs.** That matches the "solution with no problem" diagnosis — and it means v2 is mostly additive rather than a rewrite.

---

## 4. BitUnlock Tenancy: The Verified Integration Surface

BitUnlock (Cloudflare Worker + D1, live limited mainnet beta at `api.bitunlock.network`) has a real, load-bearing multi-tenant model — every table tenant-scoped, NIP-98 auth on every route, three-layer idempotency, signed kind-30078 entitlements that verify **offline** against the service pubkey. Funds never touch BitUnlock: each payment leg is an invoice minted on the recipient's own wallet.

What matters for TORCH is how narrow the extension surface actually is. Verified against the code:

### 4.1 Works today with zero BitUnlock changes

- Tenant onboarding (operator allowlists TORCH's pubkey — the operator is first-party, so this is an SQL row, not a negotiation).
- NWC / LNURL receive wallet for TORCH's coordination fees.
- **Static products**: TORCH registers a signed product event; buyer quotes, pays (1 or 2 Lightning legs), unlocks a NIP-44 envelope; BitUnlock signs an entitlement. Payload types: `claim-url`, `license-key`, `json`.
- Term access (`accessTermSeconds`) for time-bounded entitlements — usable for private-report access and subscription-shaped offerings (renewal is a manual repurchase).
- Entitlement revocation (no money moves — matches the spec's no-refund reality).
- Offline entitlement verification via the vendored SDK (`verifyEntitlement()`) — TORCH services can gate private dashboards/reports on entitlements without calling BitUnlock at request time.

### 4.2 Requires operator action (SQL/allowlist, no API)

Seller allowlisting, `execution_products` capability, `single-recipient` payment mode, `accrual` billing mode.

### 4.3 Requires code changes inside BitUnlock's repo

- Any TORCH-specific execution input/output schema — the validator registry is **hardcoded** (`src/execution/validate-input.ts`); an unregistered schema name fails every quote. Today only the Satisfied tenant's three schemas exist.
- Any non-OpenAI-shaped provider adapter (the execution runner speaks `POST /v1/chat/completions`, bearer token).
- Webhooks — **none exist**; tenants poll `/v1/tenant/orders`. (Specified in `docs/FUTURE_APPLICATION_PERMISSION_ROADMAP.md` §4, unbuilt.)
- Any third payment recipient — `PAYMENT_ROLES` is frozen at `["seller","bitunlock"]` and the constants file explicitly forbids routing to arbitrary third parties.

### 4.4 Does not exist and is not close

Recurring subscriptions, payment splits, refunds, escrow/holds, prepaid usage allowances, and per-action fees cheap enough for micro-coordination. The Cashu micropayments rail was built, live-tested, and **reverted** (post-mortem: BitUnlock `docs/CASHU_MICROPAYMENTS_PLAN.md` §8a) with two unsolved blockers: per-rail fee economics and durable custody of redeemed proofs.

### 4.5 Consequences for the spec

These are corrections the spec must absorb (tracked as spec-v0.2 revisions):

1. **Mode D (direct multi-party settlement) is a BitUnlock protocol-version change**, not an integration. The spec's Phase E placement is right; nothing earlier may depend on it.
2. **Pledges live entirely in TORCH.** BitUnlock has no holds and explicitly rejects escrow. The spec already treats a pledge as a signed statement rather than money — that is now the *only* option, which is fine: pledges become signed Nostr events on TORCH's side, settled just-in-time as ordinary BitUnlock purchases.
3. **Coordination fees must be milestone-grained, not task-grained.** BitUnlock's fee floor is 10 sats/order with 100 bps and per-order invoice overhead, and the micro-fee problem is the specific thing the Cashu attempt failed to solve. Sub-1000-sat per-task fees are uneconomical. Price the coordination fee per milestone (or per campaign), delivered as one static product purchase.
4. **Order-state awareness is polling.** Until BitUnlock ships webhooks, TORCH's campaign service polls order status. Design the campaign state machine to be poll-driven from day one.
5. **The "verification fee as a separate economic line" (spec §16.2)** maps cleanly to a *second static product*, not a payment split.
6. **Refund language in the spec** ("unused sats return to sponsor") must be scoped: BitUnlock never refunds. Refund of unused *compute* happens at the provider layer (Routstr session refunds; unspent sponsor-owned OpenRouter credit simply stays with the sponsor). Refund of TORCH *fees* is off-platform goodwill, not protocol.
7. **BitUnlock has no license.** TORCH must vendor `@bitunlock/protocol`/`@bitunlock/sdk` the way BitRoad does, which requires the operator (same person, today) to resolve licensing before TORCH 2.0 itself can be open source. This is a real blocker for an open-source-first product and should be resolved early.

**Precedents to copy:** BitRoad (second repo consuming BitUnlock's versioned contract with conformance vectors) for the static-product shape; Satisfied (only execution-product tenant, schemas hardcoded into BitUnlock) for the execution shape. Phase A TORCH looks like BitRoad. Execution products are optional later.

---

## 5. Concept-to-Seam Map

| Spec concept | Implementation seam | Work |
|---|---|---|
| Task contract + bundle digest (spec §8) | Lock event content JSON (`src/lib.mjs`) already has `gitCommit`/`promptHash` | Add `campaignId`, `milestoneId`, `taskContractHash`, `leaseId`; define d-tag grammar for v2 scopes |
| Compute lease enforcement | `run-selected-prompt.mjs` spawn seam + new provider gateway | New: gateway proxies OpenAI-compatible traffic, meters tokens, kills at ceiling, reconciles against lease |
| Milestone gates (spec §5, §6) | Scheduler selection layer (replace roster round-robin) | New: milestone DAG store; scheduler asks "which tasks are *ready to exist*" before "which are unlocked" |
| Evidence bundle (spec §11) | `verify-run-artifacts.mjs` artifact families | Extend: normalize to one signed JSON bundle; publish hash to relays, content to campaign store |
| Prompt authority hierarchy (spec §8) | `AGENTS.md` constitution + prompt governance service | Extend: add contract layers; compile-and-hash the assembled bundle (assembly is currently textual concatenation) |
| Campaign/pledge/signal events (spec §9) | Lock protocol's publish/query plumbing | New event kinds + schemas; reuse quorum publisher, relay health, dashboard subscription model |
| Coordination-fee checkout | BitUnlock static product (json payload) | New: TORCH campaign service registers products, polls orders, verifies entitlements offline |
| Private report access (spec §16.3) | BitUnlock term-access entitlements + offline verify | New: entitlement-gated report endpoint |
| Verifier independence (spec §11) | None today | New: verifier role runs on a *different* operator/lease than the implementer; blind assignment in campaign service |
| Durable identity | None (ephemeral keys by design for locks) | New: npub-based actor registry (maintainer/sponsor/verifier/worker); locks stay ephemeral, *actors* don't |
| Campaign ledger (spec §5, §20) | Unused Postgres migration is the only prior art | New: real datastore decision (§6.2) |

---

## 6. Consequential Design Decisions (open, with recommendations)

### 6.1 Identity: two-key model

Keep ephemeral per-lock keys (they make lock spam cheap to abandon and leak nothing), but add a durable actor identity: each lock event gains an `actor` field containing the worker's npub plus a signature over the lock's d-tag, so a lock is *claimed ephemerally* but *attributable durably*. Maintainers, sponsors, and verifiers are npubs from day one — this is also what BitUnlock auth (NIP-98) already assumes.

### 6.2 Datastore: campaign service owns state; relays own signals

Relays are for discoverable, signed *signals* (campaign announced, milestone funded, task locked, evidence hash). The authoritative campaign/milestone/lease/ledger state needs a database with transactions. Recommendation: follow BitUnlock's stack (Cloudflare Worker + D1) for the TORCH campaign service — the operator already runs that stack in production, and the idempotency/authz patterns can be copied rather than reinvented. The 1.x CLI/scheduler stays filesystem-based and talks to the campaign service over REST + NIP-98.

### 6.3 Multi-project: coordinator-side campaigns, repo-side execution

1.x installs *into* a host repo. Keep that: the execution half of TORCH (scheduler, locks, verification gates) remains a per-repo installation, which is exactly what "maintainer consent" looks like in practice — a maintainer who hasn't installed TORCH can't have TORCH runs. The campaign half (funding, milestones, evidence registry, BitUnlock tenancy) is one hosted service spanning projects. The seam between them is the task contract: the campaign service issues it, the repo-side scheduler executes and reports against it.

### 6.4 Fees: milestone-grained, static-product-shaped (forced by §4.5)

One BitUnlock purchase per milestone coordination fee; one per verification reserve; term-access products for subscriptions. No per-task payments until a micro-fee rail actually exists.

### 6.5 Compute: Mode A only in Phase A

Sponsor-created, spend-limited OpenRouter keys (or sponsor-run inference). TORCH never holds a provider credential in Phase A — the sponsor configures the key directly into the repo-side runner environment. Mode B (ephemeral Routstr sessions held by a TORCH gateway) is deferred until the gateway exists *and* gets the durable-custody design pass that the Cashu post-mortem demands for any bearer credential TORCH controls.

---

## 7. Phase A Work Plan (grounded)

Ordered; each item is independently shippable on this branch.

1. **Spec v0.2** — fold §4.5 corrections into `DEVELOPMENT_NETWORK_SPEC.md`.
2. **Event schema extension** — task-contract fields in lock content + v2 d-tag grammar; JSON Schemas under `docs/v2/schemas/`; parser/tests alongside the existing lock schema work.
3. **Campaign object model** — campaign / milestone / task-contract / pledge / evidence-bundle schemas (documents first, service later). The stewardship-contract fields in spec §3.1 become the first machine-readable manifest — this doubles as the public `ai-contributions` manifest format.
4. **Evidence bundle v1** — normalize `verify-run-artifacts.mjs` output + task-log into one signed JSON document; publish its hash as a Nostr event.
5. **Actor identity** — durable npub attribution on locks and evidence (§6.1).
6. **Campaign service skeleton** — Worker + D1, REST + NIP-98, poll-driven BitUnlock order tracking; registers one real static product: "TORCH coordination — pilot campaign."
7. **Pilot** (spec §24) — one opted-in repo, one Stewardship campaign, sponsor-supplied limited OpenRouter key, TORCH-operated worker, one independent verifier, coordination fee paid through BitUnlock, public cost/outcome summary.

Items 1–4 need no BitUnlock coordination at all. Item 6 needs allowlisting (operator SQL). Nothing in Phase A needs a BitUnlock code change.

---

## 8. Success Criteria for This Branch

The branch is ready to merge toward 2.0 when:

- The spec and this bridge agree (no §4.5-class contradictions remain).
- v2 schemas exist and validate in CI like the existing scheduler contracts do.
- A lock event can carry a task-contract reference end-to-end through the existing scheduler without breaking 1.x behavior (v2 fields optional, additive).
- The pilot of §7.7 has run at least once, even with the operator playing all human roles.
