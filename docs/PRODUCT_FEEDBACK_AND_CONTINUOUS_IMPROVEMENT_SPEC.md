# Product Feedback and Continuous Improvement — Required Feature Specification

Status: owner-approved roadmap requirements; implementation deferred.
Added: 2026-10-07. Applies to the Portable Agent Fleet product.
Source: [original proposal, preserved](proposals/2026-10-07-product-feedback-and-continuous-improvement.md).

## 1. Purpose and completion boundary

TORCH MUST support the continuing lifecycle of software its fleet builds:
observe → sanitize → group → investigate → reproduce → improve → review →
release → measure → retain the lesson. Existing persistent domain agents,
ownership, backlog, authority, verification, integration and knowledge systems
remain authoritative. This is not a second orchestration system or model-training
product.

These requirements are necessary before claiming TORCH's overall product is
completed. They supplement—not replace—the existing fleet requirements.
The first usable release remains an earlier milestone. Manual approval of releases
is sufficient; autonomous production changes are optional and separately authorized.

This document records future requirements, not working capabilities. The original
proposal did not inspect TORCH; its JSON examples, service names and draft-PR
interfaces are illustrative, not verified APIs. Implementers MUST map contracts to
actual installed boundaries and qualify that mapping before dispatch.

No new implementation, collection of customer data, external model transmission,
provider provisioning, fleet reconfiguration, deployment or automatic release is
authorized by this planning intake. New records remain proposed and unassigned.
Current reliability and owner Chat priorities continue.

## 2. Product policy and signals

Each enrolled product MUST have approved ownership, tenant/source identity,
workflow scope, signal allowlists, safety classification, collection basis,
permitted model destinations, retention, budgets and release/measurement policy.
Start with one product and one deterministic failure class.

Supported signals include crashes/exceptions, workflow/import/export failures,
independent retry counts/outcomes/latency, authorized sanitized support reports,
manual corrections, failed outcomes and feature ideas. A correction may indicate
preference, error or intent; it is not ground truth. Feature requests require a
product decision. Outcome rates MUST include denominators and success criteria.

Events MUST identify the actual deployed release/artifact and applicable parser,
prompt/model/retrieval/configuration/feature-flag versions, not merely current
main. Collectors MUST be nonblocking and fail independently of customer operations.
They collect selected workflow events, not full logs or entire customer documents.

## 3. Privacy, authentication and lifecycle

Ingress MUST authenticate approved sources and bind tenant/product/policy on the
server. Client-supplied tags cannot grant access or choose another repository.
Schema enforcement, documented rejection/stripping, size limits and redaction
MUST prevent secrets, tokens, passwords and unsolicited full bodies.

Raw customer content is excluded by default. Collection requires approved purpose,
rights, scope and retention. Evidence references MUST be authorization-checked and
tenant-scoped, not public artifact URLs. External model destinations require
explicit policy. Shared code and reviewed synthetic cases may be reused;
cross-tenant raw pooling is not permitted. Aggregates need small-cohort protections.

Separate raw, sanitized and derived retention MUST follow lineage into evidence
bundles and regression fixtures. Authorized deletion propagates to descendants;
any retained minimal audit MUST be permitted and exclude deleted content.

## 4. Durable intake, grouping and dispatch

Acknowledgment follows durable acceptance. Queue leases, revision checks, bounded
retries/backoff and dead-letter visibility MUST survive interruption. Reuse TORCH
events/reconciliation where appropriate rather than introducing competing systems.

Keep four independent idempotency boundaries:

- Transport: tenant and source event identity.
- Grouping: symptom, product/workflow and applicable version context.
- Dispatch: issue and investigation generation.
- Measurement: exact change, deployment and observation window.

Dispatch MUST use durable transactional intent and reconcile uncertain external
effects by returned task/runtime IDs. Timeout is not proof an action never ran.
No event replay or crash window may duplicate investigation work.

Issue history MUST support received, validated, grouped and triaged; triage may
yield needs-evidence, product-review, rejected or eligible. Eligible work proceeds
through investigating, reproduced, patching and change-ready; then awaiting
approval, canary and observing; outcome is verified, rolled-back or inconclusive.
Active work can become blocked or failed. Transitions MUST be guarded and audited.
Grouping/splitting is reversible. Recurrence after verification creates a linked
new generation instead of disappearing under a closed historical issue.

## 5. Evidence and execution contract

Evidence bundles MUST be immutable/versioned with content fingerprints, applicable
versions, independent operation counts, impact, permitted reproduction inputs,
expected behavior and its authority, uncertainty and data restrictions.
Observations MUST remain distinct from hypotheses.

Trusted templates treat telemetry and customer text as delimited untrusted data.
Evidence cannot select commands, tools, repositories, permissions or release
policy. The trusted adapter routes into the existing authoritative task system and
approved organization; it records task ID, deduplication key and audit references.

Investigation MUST reproduce against the affected release, minimize permitted
fixtures and consider code/configuration/input/upstream/user-error/design causes.
Expected behavior comes from a specification, domain rule or qualified decision.
Insufficient evidence and working-as-intended are legitimate outcomes.

Workers use isolated worktrees without production-write credentials. Bounded
changes include neighboring regression checks. Prompt/model/configuration changes
are evaluated as versioned product changes, not automatic training.
Draft change proposals MUST show cause, evidence, checks/not-run, uncertainty,
risk, rollout and reversal. Forge PRs are optional; all integration remains through
TORCH's serialized, exact-candidate policy.

## 6. Independent verification and authority

Important claims require baseline failure, exact-candidate success and preserved
neighboring behavior. Probabilistic workflows additionally require representative
quality/cost/latency/severity evaluations and protected holdouts or blind review.
Generated tests alone are not independent proof.

Repair workers MUST NOT alter gates, thresholds, acceptance instrumentation,
holdout answers or release policy. Review validates both the implementation and
the expected truth. Merely changing an agent's identity does not establish
independence if it retains the same mutable access and answers.

Observe, investigate and propose are separate authority levels. Propose is the
initial automation ceiling; release requires explicit approval. Any future narrow
automatic release grant MUST specify product, change class, environment and limits.
Approval attaches to the exact candidate and is invalidated by material edits.

Safety-sensitive controls, physical effects, security/permissions and consequential
operational decisions require qualified authority even when the changed parser
looks small. Ingest, evidence, code and deployment permissions remain least
privilege and distinct; agents cannot mint their own credentials.

## 7. Budgets, pause and storm control

Approved tenant/product/global ingestion, storage, task, token, runtime and spend
limits MUST be mechanically enforced, with critical-failure capacity reserved.
Illustrative pilot limits in the source are not approved live settings. This
feature does not reinstate the removed fleet daily limit or alter current runtime
policy without authorization.

Synthetic/replayed/canary/agent-origin events MUST carry lineage. They remain
observable but do not count as organic improvement or recursively spawn storms.
Issue/tenant/product/global pause stops new work, revokes pending release
eligibility and safely checkpoints/stops in-flight work. Budget exhaustion MUST
NOT disable the customer's application.

## 8. Release measurement and recovery

Before approval, define target metric and denominator, baseline, eligible cohort,
guardrails, minimum volume and observation window. Use version-matched comparable
cohorts and concurrent controls where warranted; correlation is not proof of cause.
Observe quality, latency, cost and downstream effects—not just fewer errors.

Low traffic or zero reports alone MUST NOT imply success. Insufficient or
contradictory evidence yields inconclusive and, where necessary, owner review.

Canary/feature-flag rollout and rollback require scoped authority. Rolling back
code does not undo notifications, exports, records or physical actions.
Migrations/data changes require compatibility and roll-forward planning; blind
old-code rollback is not a safe universal recovery strategy.

## 9. Lessons, ownership and dashboard

Reviewed regression cases MUST retain data rights, expected-truth authority,
provenance, version applicability and maintenance ownership. Contradictory or
unverified material is quarantined, not promoted to truth. Reuse
[project/domain knowledge](PROJECT_KNOWLEDGE_SPEC.md); no second KB or automatic
provider-training dataset.

A dedicated Support/Feedback Console view MUST show conclusions first, with
compact cards and detail modals consistent with
[Chat and compact cards](CONSOLE_CHAT_AND_COMPACT_CARDS_SPEC.md).
Expose sanitized evidence, confidence, independent counts, versions, state
history, task/change links, costs, approvals, cohort and outcome. Use existing
agent Chat/evidence drill-down for discussion.

Audited, role- and tenant-bound actions include merge/split, rejecting an
interpretation, requesting evidence, pause and routing product decisions.
Product truth, engineering review and release ownership are distinct
responsibilities, even if one human initially holds several roles; no mandatory
new management identity is implied.

Measure time to reproduce/accepted fix, recurrence, verified improvement,
false positives, escaped regressions and cost per verified improvement—not
patch count.

## 10. Required features and authoritative backlog

The following IDs are an index into the existing backlog, not another task queue.
Every item is initially normal-priority, proposed, unassigned and deferred.
The dependency graph below records feature prerequisites; existing authority,
event/reconciliation, pipeline/evidence, knowledge and release primitives MUST
be reused or qualified rather than duplicated.

| Backlog ID | Required feature | Prerequisites |
| --- | --- | --- |
| `TASK-feedback-contract` | Define product support policy and pilot | Approved pilot and policy decisions |
| `TASK-feedback-signals` | Collect nonblocking versioned product feedback | `TASK-feedback-contract` |
| `TASK-feedback-privacy` | Enforce authenticated tenant isolation and data minimization | `TASK-feedback-contract` |
| `TASK-feedback-retention` | Implement lineage-aware retention and deletion | `TASK-feedback-privacy` |
| `TASK-feedback-intake` | Add durable replay-safe issue intake and grouping | `TASK-feedback-signals`, `TASK-feedback-privacy` |
| `TASK-feedback-evidence` | Build immutable support evidence and trusted behavior contracts | `TASK-feedback-intake` |
| `TASK-feedback-dispatch` | Connect support issues to existing TORCH work idempotently | `TASK-feedback-evidence` |
| `TASK-feedback-investigation` | Investigate reproducible issues and propose bounded changes | `TASK-feedback-dispatch` |
| `TASK-feedback-review` | Protect independent evaluation and release authority | `TASK-feedback-investigation` |
| `TASK-feedback-governor` | Bound support work and prevent recursive feedback storms | `TASK-feedback-dispatch` |
| `TASK-feedback-outcomes` | Measure approved releases and recover safely | `TASK-feedback-review`, `TASK-feedback-governor` |
| `TASK-feedback-knowledge` | Curate verified lessons and regression knowledge | `TASK-feedback-retention`, `TASK-feedback-outcomes` |
| `TASK-feedback-console` | Add a focused Support and Feedback inspector | `TASK-feedback-evidence`, `TASK-feedback-governor`, `TASK-feedback-outcomes` |
| `TASK-feedback-qualification` | Qualify the complete post-launch support lifecycle | `TASK-feedback-signals`, `TASK-feedback-privacy`, `TASK-feedback-retention`, `TASK-feedback-intake`, `TASK-feedback-evidence`, `TASK-feedback-dispatch`, `TASK-feedback-investigation`, `TASK-feedback-review`, `TASK-feedback-governor`, `TASK-feedback-outcomes`, `TASK-feedback-knowledge`, `TASK-feedback-console` |

## 11. Integration sequence

1. Approve pilot contract and real API/storage/authority mapping. Define signal
   permissions and release truth before data collection.
2. Deliver nonblocking collectors and authenticated privacy enforcement, then
   durable intake, replay/dead-letter inspection and deletion lineage. Qualify
   crashes, replay and tenant isolation before agent dispatch.
3. Build immutable evidence and idempotent existing-fleet dispatch. Qualify a
   sandbox investigation and draft change with protected independent gates,
   budget/pause controls and no production-write credentials.
4. Add approved release measurement/recovery, curated regression knowledge and
   the Support inspector; run the complete narrow pilot and independent QA.

Later automatic release, generic all-language SDKs, model training, shared raw
data pooling and complex prioritization are NOT mandatory for this initial
completion gate. No stage automatically activates the next.

## 12. Qualification scenarios required before completion

| ID | Required behavioral evidence | Primary feature coverage |
| --- | --- | --- |
| PF-Q01 | Replaying one source event produces one observation and one task per investigation generation. | intake, dispatch |
| PF-Q02 | Crash before/after dispatch preserves accepted work and reconciles uncertain effects without duplicate execution. | intake, dispatch |
| PF-Q03 | Cross-tenant spoofing, evidence references and actions are refused. | privacy, console |
| PF-Q04 | Malicious telemetry, secrets and oversized content cannot alter trusted instructions or escape policy. | signals, privacy, evidence |
| PF-Q05 | Old-release failures remain attributed correctly; recurrence creates a linked new generation. | signals, intake |
| PF-Q06 | Affected baseline fails, exact candidate passes, neighboring cases hold and expected truth has independent authority. | investigation, review |
| PF-Q07 | Repair workers cannot change acceptance/holdouts or acquire production/release authority. | review |
| PF-Q08 | Bursts and recursive feedback remain bounded; limits, pauses, retries and dead letters are visible and recoverable. | governor, intake |
| PF-Q09 | Inspector traces event → sanitized evidence → task → change → approval → deployment → outcome with audited actions. | console, outcomes |
| PF-Q10 | Reversible flag recovery succeeds; irreversible migration/side effects require safe forward recovery rather than false rollback claims. | outcomes |
| PF-Q11 | Low-volume or contradictory observations conclude inconclusive, not falsely verified. | outcomes |

All scenarios require exact candidate/installed provenance and independent QA.
One approved product pilot MUST demonstrate the full lifecycle and a durable,
rights-cleared lesson. Fixture-based qualification does not claim an actual
customer rollout. The final qualification item remains open until both are proven.

Include the source's synthetic machine-log example: 120 seconds means two minutes,
not 120 minutes; repeated events are distinguished from independent operations.
Exercise minutes, decimals, absent/malformed fields and historical formats.
Do not rewrite historical customer records or automate ambiguous/safety-sensitive
cases to manufacture a passing result.

## 13. Source coverage and remaining implementation decisions

| Original proposal sections | Coverage here |
| --- | --- |
| Executive summary; 1 objective | §§1–2, 8–9 |
| 2 signals; 3 architecture; 4 event contract | §§2–5 |
| 5 durable state; 6 evidence/task contract | §§4–5 |
| 7 investigation; 8 acceptance gates | §§5–6 |
| 9 autonomy; 10 privacy | §§3, 6 |
| 11 budgets; 12 measurement/recovery | §§7–8 |
| 13 worked example | §12 |
| 14 MVP; 15 inspector/ownership | §§9–11 |
| 16 acceptance criteria | §12 PF-Q01–11 |
| 17 open decisions | This section and contract task |

Before implementation, decide the pilot/product/failure class, actual TORCH task
boundary, storage/migration mapping, lawful data fields/rights, named authorities,
approved budgets/retention/observation thresholds, deployment/recovery adapter and
safety workflows. These are implementation prerequisites, not assumptions made
by this intake. The proposal's example contracts MUST NOT be advertised as shipped
APIs.
