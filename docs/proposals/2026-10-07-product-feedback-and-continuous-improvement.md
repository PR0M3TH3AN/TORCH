# TORCH Product Feedback and Continuous Improvement Loop

Design proposal · 7 October 2026

Audience: TORCH engineering and product owners

## Executive summary

TORCH should extend its software factory beyond building and shipping products. Deployed products should produce structured feedback that TORCH can investigate, turn into tested changes, and evaluate after release.

The proposed loop is:

**Observe → sanitize → group → investigate → reproduce → improve → review → release → measure → retain the lesson.**

Start with automatic investigation and draft pull requests, with human approval for release. A correction, complaint, or unusual metric is evidence to examine, not permission to modify production. The first implementation should address one narrow failure class in one product, using TORCH's existing task execution boundary rather than creating a second agent orchestration system.

The output of each successful loop is a verified product improvement, a durable regression case, and a measured result. This is an engineering feedback system, not a claim that the underlying model trains itself from customer activity.

**Status and scope:** This document proposes architecture and interfaces. No TORCH repository was inspected. Component names, JSON contracts, and integration points below are provisional, not verified existing APIs. The design is reusable across the industrial and business products discussed, without assuming that their data, permissions, or risk profiles are interchangeable. Creating this spec does not authorize implementation, customer-data transmission, or production changes.

## 1 Product objective

Make real-world failures and user friction actionable for the software factory without requiring a person to manually assemble every bug report.

For a deployed product, the loop should answer:

- What went wrong, for which workflow and product version?
- Is it reproducible, and what evidence supports the expected behavior?
- Is the cause in code, configuration, prompts, an integration, input quality, or product design?
- Can TORCH propose a bounded change with a reliable acceptance test?
- Did the deployed change improve the intended outcome without causing another problem?

The system must also conclude “insufficient evidence,” “working as intended,” “needs a product decision,” or “cannot safely automate.” Producing more patches is not itself success.

## 2 Signals and routing

Collect explicit product events rather than indiscriminately recording sessions or customer documents.

| Signal | Useful evidence | Initial route |
| --- | --- | --- |
| Crash or exception | Sanitized stack signature, operation, release, failure count | Bug investigation |
| Failed import or export | Format, schema version, error code, safe fixture | Bug or compatibility investigation |
| Repeated retries | Independent attempts, eventual outcome, latency | Investigate after threshold |
| Manual correction | Field, previous and edited values when permitted, correction context | Candidate defect requiring validation |
| Support report | Authorized sanitized excerpt, linked workflow, reporter context | Triage with uncertainty preserved |
| Outcome failure | Explicit completion criterion, denominator, failed result | Investigate product effectiveness |
| Feature idea | User problem, requested behavior, affected audience | Product backlog and human decision |

A deterministic, reproducible import failure can become an engineering task directly after policy checks. A request for a new report, workflow, or business rule needs product prioritization and a human-approved specification before implementation.

Manual corrections are not ground truth. Users may choose a preference, override a rule, make an error, or change their intent. Preserve the distinction between an observed edit and a validated expected answer. Do not reward the system merely for matching every edit or reducing visible correction controls.

## 3 Proposed architecture

```text
Deployed product
  → runtime collector
  → privacy filter and authenticated ingestion
  → durable event queue
  → deduplication and triage
  → immutable evidence bundle
  → adapter to existing TORCH task boundary
  → reproduction and evaluation
  → isolated worktree and bounded patch
  → draft PR and independent review
  → approved release and canary
  → outcome measurement or safe rollback
  → curated regression library
```

### Runtime collector and privacy filter

Instrument a small number of explicit events at workflow boundaries. The collector must be nonblocking: feedback outages must not stop an import, slow a control interface, or change a user's business transaction.

Use allowlisted schemas and redact at the source where possible. Ingestion applies another schema, size, secret, and policy check before durable storage. Unknown fields are rejected or stripped under a documented rule. Never collect passwords, access tokens, full request bodies, or entire machine logs by default.

### Queue and triage service

Accept an event only after durable recording. Acknowledge workers after their state transition is committed. Retries use backoff and a dead-letter path. An outbox or equivalent transaction boundary connects stored triage decisions to task dispatch without silently losing work.

Deduplication groups repeated symptoms; triage decides eligibility, severity, confidence, and route. Models may suggest classifications, but deterministic policy controls credentials, budgets, task creation, and release eligibility.

### Evidence store and TORCH adapter

The evidence store holds a versioned manifest and approved references, not unrestricted access to production. The adapter translates an eligible issue into TORCH's actual task format and records the task identifier returned by TORCH. Implementation must first discover that existing boundary and map this proposal onto it.

### Release observer and regression library

The observer joins release records with outcome measurements. It distinguishes a fix candidate from a verified improvement. Reviewed reproductions and tests become reusable regression cases with provenance, applicability, and ownership.

## 4 Proposed event contract

This illustrative JSON is a proposed wire format. All identifiers and values are synthetic. Production authentication, tenant identity, and policy status must be established by trusted services; client-provided labels alone are insufficient.

```json
{
  "schema_version": "1",
  "event_id": "evt_demo_0042",
  "event_type": "field_correction",
  "occurred_at": "2026-10-07T05:42:00Z",
  "product_id": "machine_log_reader",
  "tenant_scope": "tenant_demo",
  "workflow_id": "import_machine_log",
  "operation_id": "op_demo_017",
  "release": {
    "deployment_id": "deploy_demo_021",
    "artifact_digest": "sha256:demo-placeholder",
    "commit": "example-commit",
    "parser_version": "0.8.2",
    "prompt_version": null,
    "model_version": null,
    "config_version": "cfg_demo_003"
  },
  "signal": {
    "field": "duration_minutes",
    "previous_value": 120,
    "edited_value": 2,
    "value_status": "unverified_user_correction",
    "input_format": "synthetic_machine_log_v1",
    "failure_signature": "duration_unit_seconds_as_minutes"
  },
  "evidence_refs": ["evidence://demo/synthetic-fixture-001"],
  "privacy": {
    "policy_id": "feedback-minimal-v1",
    "collection_basis_ref": "policy-record-demo",
    "sanitizer_version": "1",
    "contains_raw_customer_content": false
  },
  "lineage": {
    "source": "runtime",
    "parent_task_id": null,
    "originating_change_id": null
  }
}
```

The server adds receipt time, authenticated tenant binding, validation result, and integrity metadata. Sensitive field values should be omitted or replaced with approved classifications unless their collection and use are specifically permitted. Evidence references resolve through tenant-scoped authorization, not public URLs.

Record all behavior-affecting versions, including model, prompt, retrieval data, configuration, and feature-flag snapshots when relevant. Preserve the original observed deployment even if the current product has moved on. A failure on an old release must not be attributed to the newest commit by default.

## 5 Durable state and duplicate control

Use a durable issue record with a transition history:

```text
received → validated → grouped → triaged
triaged → needs_evidence | product_review | rejected | eligible
eligible → investigating → reproduced → patching → pr_ready
pr_ready → awaiting_approval → canary → observing
observing → verified | rolled_back | inconclusive
```

Every active stage can move to a recorded blocked or failed state. Workers use leases, bounded retries, and compare-and-set transitions so a crash or concurrent worker cannot advance the same task twice.

Use separate keys for separate problems:

- **Event idempotency:** authenticated tenant plus event ID deduplicates transport retries.
- **Issue grouping:** tenant, product, workflow, normalized symptom, and relevant version context group related failures.
- **Task dispatch:** issue ID plus investigation generation identifies one intended TORCH task.
- **Release observation:** change ID plus deployment ID identifies one measurement window.

Keep symptom identity separate from affected release ranges. A recurrence after a verified fix becomes a new linked investigation generation rather than disappearing into a permanently closed issue. Low-confidence groupings remain reversible, with the underlying event references retained.

Do not promise exactly-once external effects. Prefer downstream idempotency keys; otherwise reconcile returned task and PR identifiers before retrying uncertain requests. Never launch a second agent run merely because the first response timed out.

## 6 Evidence and task contract

An evidence bundle separates observations from hypotheses and freezes the inputs used for an investigation. Additional evidence produces a new bundle version. Its manifest contains event references and counts, affected releases, impact estimates, a safe reproducer, proposed expected behavior and its authority, uncertainty, and applicable data restrictions.

The following is a proposed handoff envelope, not an existing TORCH function signature:

```json
{
  "contract_version": "1",
  "task_idempotency_key": "issue_demo_012:g1",
  "issue_id": "issue_demo_012",
  "kind": "investigate_and_propose_fix",
  "product_id": "machine_log_reader",
  "tenant_scope": "tenant_demo",
  "evidence": {
    "bundle_id": "bundle_demo_012_v1",
    "manifest_digest": "sha256:demo-placeholder",
    "observations": 12,
    "independent_operations": 9,
    "reproducer_ref": "evidence://demo/synthetic-fixture-001",
    "expected_behavior": "120 seconds becomes 2 duration_minutes",
    "authority": "approved input-format specification",
    "uncertainties": ["Historical formats may use other units"]
  },
  "scope": {
    "repository_ref": "configured-product-repository",
    "base_revision": "resolved-immutable-revision",
    "change_class": "parser-unit-conversion",
    "excluded_changes": [
      "permissions",
      "release_policy",
      "acceptance_gates",
      "production_data"
    ]
  },
  "policy": {
    "autonomy_tier": "investigate_and_draft_pr",
    "gate_policy_ref": "gates/parser-v1",
    "budget_policy_ref": "budgets/pilot-v1",
    "release_approval_required": true
  },
  "required_outputs": [
    "reproduction_result",
    "root_cause_and_alternatives",
    "patch_or_no_change_explanation",
    "evaluation_results",
    "draft_pr_reference",
    "release_and_measurement_plan"
  ]
}
```

The adapter validates the envelope against server-owned product mappings and policy. Evidence cannot select an arbitrary repository, inject shell commands, authorize new tools, or broaden access. Task instructions come from trusted templates; user text, logs, and support messages are clearly delimited untrusted data.

## 7 Investigation and change workflow

1. **Confirm the symptom.** Reproduce the affected version with a permitted fixture. If unavailable, request the minimum missing evidence or stop with a documented uncertainty.
2. **Establish expected behavior.** Use a product specification, validated domain rule, or human decision. Do not infer correctness solely from a correction count.
3. **Test plausible causes.** Distinguish a parser defect from changed input conventions, configuration drift, upstream failure, and incorrect user expectations.
4. **Create an isolated worktree.** Pin the base revision and approved dependencies. Use synthetic or separately authorized data. No production write credentials are present.
5. **Make a bounded patch.** Prefer the smallest change that addresses the demonstrated cause. Run the product's existing tests plus the new reproducer and relevant neighboring cases.
6. **Open a draft PR.** Include evidence provenance, root cause, changed behavior, test results, known limits, risk, rollout, and reversal plan. Mark checks that were not run.
7. **Obtain independent review.** Reviewers check both implementation and whether the proposed expected behavior is valid. Approval applies to the evaluated commit; subsequent material edits require re-evaluation.

If a prompt or model configuration change is appropriate, version and evaluate it as a product change. Runtime feedback is not automatically added to a training dataset or provider account.

## 8 Acceptance gates and evaluation integrity

Acceptance policy lives outside the repair agent's editable scope. The agent cannot lower thresholds, remove failing cases, rewrite protected expected answers, disable instrumentation, or grant itself a release exception to make its patch pass.

For deterministic bugs, require a test that fails on the affected baseline and passes on the candidate, plus existing regression and compatibility checks. For probabilistic behavior, define a representative evaluation set, repeat conditions where needed, and evaluate quality alongside latency, cost, and failure severity.

Use independently maintained holdouts or blind review when the agent could otherwise overfit to visible cases. Keep holdout answers inaccessible to the repair worker. A different agent with the same mutable inputs is not sufficient independence by itself; protected test ownership and release policy matter.

Quarantine candidate regression cases until their expected outputs and data rights are reviewed. Preserve contradictory examples and version-specific behavior. Do not turn every customer edit into a permanent “correct” test, repeatedly tune to a holdout, or count generated tests as independent evidence of improvement.

## 9 Autonomy and permission boundaries

| Tier | Allowed behavior | Release policy |
| --- | --- | --- |
| Observe | Collect permitted events and show findings | No change |
| Investigate | Reproduce and propose a diagnosis | No change |
| Propose | Make sandboxed changes and draft PRs | Human review and release approval |
| Narrow automated release | Only explicitly preauthorized low-risk classes | Deterministic gates, bounded rollout, automatic stop rules |

The pilot uses **Propose**. Later automated release is a separate permission decision, scoped by product, change class, deployment environment, and limits. Passing tests does not create authorization.

Do not autonomously change machinery controls, physical safety behavior, security boundaries, authentication, permissions, or sensitive operational decisions. Such findings route to qualified owners. The same restriction applies when an apparently small parser change would feed a safety-critical downstream decision.

Use separate least-privilege identities for ingestion, evidence retrieval, repository changes, and deployment. Tokens should be short-lived where supported and restricted to the intended resource. The agent cannot create credentials or expand privileges to unblock itself.

## 10 Privacy and tenant isolation

Define the collection purpose, permitted fields, consent or other approved collection basis, retention, and deletion behavior for each product before enabling feedback. Customer content is excluded by default. A useful safe fixture often preserves a format defect without retaining the original document.

Bind tenant identity from authentication. Apply it to queue routing, database queries, evidence storage, cache keys, deduplication, task credentials, and inspector access. Test isolation at each boundary. Never pool raw tenant content merely because the same code serves several customers.

Cross-tenant improvements may use shared code and reviewed synthetic regression cases. Broader aggregate analysis requires an approved policy and must avoid small-group disclosure. Redaction alone does not prove a payload is anonymous.

Maintain retention periods for raw events, sanitized evidence, and derived cases separately. A deletion request must follow provenance links into bundles and regression fixtures where applicable. Keep a minimal non-content audit record if policy permits. Any external model or service receives only data and destinations explicitly approved for that use.

## 11 Budgets and loop storm prevention

Set per-tenant, per-product, and global ingestion, storage, task, token, runtime, and spend limits. Enforce limits outside the agent. Reserve enough capacity to record critical failures without allowing a noisy tenant to consume all investigation capacity.

Suggested pilot defaults are one active investigation per issue generation, two bounded attempts before human triage, and a one-hour cooldown for the same unresolved symptom. These are proposed starting values, not measured production requirements. Operators must approve actual daily spend and concurrency caps before activation.

Label synthetic tests, replay traffic, canaries, and agent-originated activity. Preserve their lineage and exclude them from organic-user success metrics. Suppress recursive task creation from the agent's own test failures while still retaining those failures as evidence.

Provide pause controls at issue, tenant, product, and global scope. A pause stops new work and revokes pending release eligibility; in-flight workers checkpoint or stop safely. A task budget exhaustion must never disable customer-facing functionality.

## 12 Release measurement and recovery

Before release, register the target metric, denominator, baseline, eligible population, guardrails, minimum observation volume, and time window. For the example below, measure incorrect unit conversions per eligible import, not simply the number of corrections.

A human-approved deployment starts with a reversible feature flag or limited canary when the product supports it. Compare equivalent input formats and version cohorts; use a concurrent control where appropriate. Monitor import success, severe errors, latency, and downstream behavior alongside the target improvement.

Do not declare success from zero reports on low traffic. Insufficient data yields an inconclusive result and an owner decision, not an automatic permanent rollout. Correlation after release is useful evidence; it is not by itself proof that the patch caused the improvement.

Predefine abort thresholds and identify who can execute recovery. Automatic recovery is allowed only for explicitly authorized reversible operations. A rollback flag does not undo exported files, notifications, corrected records, or physical actions. Schema migrations and incompatible data writes require a reviewed compatibility and recovery plan; blindly deploying old code can make an incident worse. Prefer backward-compatible changes and tested roll-forward procedures where reversal is unsafe.

## 13 Worked example for a machine log reader

An approved synthetic input contains `cycle_duration: 120 s`. The product displays `duration_minutes: 120`; a user changes it to `2`.

1. The collector emits a permitted correction event with the deployment and parser versions. The correction remains labeled unverified.
2. Triage groups 12 events from nine independent import operations within the same tenant. Repeated clicks and retransmissions do not inflate independent occurrence counts.
3. A reviewer or trusted format specification establishes that the input value is seconds and the output field is minutes. The sanitized fixture reproduces the defect on the affected release.
4. TORCH investigates the parser, confirms the missing conversion, and creates a narrow patch in an isolated worktree. It also tests explicit minute units, decimal seconds, missing units, malformed inputs, and supported historical formats.
5. A draft PR explains that this changes interpretation of future imports. It does not silently rewrite historical records; any repair of those records requires a separate authorized plan.
6. After review and approved canary release, measurement checks eligible imports with explicit second units and neighboring formats. Stable guardrails and sufficient evidence support expansion; otherwise the canary pauses or follows its approved recovery plan.
7. The reviewed synthetic case enters the regression library with its specification reference and applicable format versions.

If the format specification is ambiguous or the field feeds machinery control, the loop stops for the responsible owner rather than guessing and deploying.

## 14 MVP and implementation milestones

**Milestone 1: One observable failure class.** Pick one product and a deterministic import failure or unit-conversion defect. Define its event schema, collection policy, owner, expected behavior, and success metric. Deliver a minimal collector plus authenticated ingestion webhook or service.

**Milestone 2: Durable intake and inspection.** Add a queue, issue store, deduplication, dead-letter handling, and a small inspector. Demonstrate safe replay, tenant isolation, and restart recovery before adding agents.

**Milestone 3: TORCH task adapter.** Inspect the actual task boundary, map the proposed envelope, and launch one idempotent sandboxed investigation. Deliver a reproducible fixture and draft PR. Keep release manual.

**Milestone 4: Close the loop.** Attach review and deployment records, run the post-release check, exercise a safe recovery path, and curate the regression case. Pilot success requires an observed improvement or an honest inconclusive result with ownership.

Defer a generic SDK for every language, automatic training, fleet-wide issue pooling, complex prioritization models, and autonomous deployment. The smallest useful loop should work end to end before its scope expands.

## 15 Inspector and operational ownership

The inspector should expose an issue's sanitized evidence, confidence, independent occurrence count, affected versions, state history, task and PR links, cost, policy decisions, approval status, release cohort, and measured outcome.

Operators need to merge or split groups, mark a proposed interpretation incorrect, request evidence, pause work, and record a product decision. Every action is audited. Access must obey tenant and role boundaries; the inspector is not a shortcut around evidence permissions.

Assign three responsibilities even if one person initially holds them: a product owner for intended behavior, an engineering reviewer for changes, and a release owner for rollout and recovery. Track time to reproducible diagnosis, accepted fixes, recurrence, verified outcome improvements, false-positive investigations, escaped regressions, and cost per verified improvement.

## 16 Acceptance criteria

The pilot is ready when these checks pass:

- Replaying an event many times produces one logical event and no duplicate active task.
- A worker crash around dispatch recovers or reconciles without losing the issue or duplicating the external action.
- Identical symptoms in two tenants never expose one tenant's content to the other.
- Secrets, unexpected payload fields, oversized inputs, and instruction-like telemetry are rejected or safely handled without executing embedded instructions.
- An old-release event retains its original attribution; a post-fix recurrence opens a linked new investigation.
- The synthetic reproduction fails on the affected baseline and passes on the proposed patch; neighboring cases remain valid.
- The repair agent cannot edit protected gates, access holdout answers, obtain production write credentials, or release without the required approval.
- Bursts, recursive test signals, exhausted budgets, and dead-letter events remain bounded and visible.
- The inspector traces one issue from event through PR, deployment, outcome, and curated regression case.
- The release drill distinguishes a safe flag reversal from a migration or side effect requiring human-led recovery.
- An insufficient-evidence case ends as unresolved or inconclusive, never as a fabricated successful improvement.

## 17 Decisions and open questions

**Proposed decisions:** Build a feedback-to-PR loop first; reuse TORCH orchestration; make evidence durable and tenant-scoped; keep release manual; protect acceptance gates; measure outcomes; curate rather than automatically ingest regression cases.

**Resolve before implementation:** Which product and failure class form the pilot? What is TORCH's actual task interface and task-status contract? Where do events and evidence live? Which customer-data policy permits each field? Who owns expected behavior, review, and release? What are the approved budgets, retention periods, rollout limits, and observation thresholds? Which downstream workflows are safety-sensitive? What recovery mechanisms already exist?

The first concrete engineering step is to map this proposal onto one product and TORCH's verified task boundary, then prove a single safe loop from runtime signal to measured result.
