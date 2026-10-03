# Operational flow improvements and Ops responsibility pilot

Owner approved 2026-10-03. Extends SELF_HEALING_QUALIFICATION_PLAN.md and existing
services, backlog and authority. No additional standing agent is created.

## Operational incidents and wait resolution

An incident connects the existing task, message, approval, check, resource and
runtime evidence. It does not become a second task ledger. Record stable cause
identity, accountable resolver, affected work, first/last observation, next action,
configurable response deadline, escalation authority and resolution evidence.
Keep received, acknowledged, acted-on and resolved distinct. A reply, timeout,
state churn or healthy doctor result cannot resolve the underlying condition.

Acceptance scenarios:

- A waits on B, B acknowledges but does not decide: A remains waiting; a due
  deadline produces one actionable escalation to the correct manager.
- A current decision resolves the wait: a refreshed observation removes the
  active escalation, preserving original history and exact decision evidence.
- Duplicate, reordered or missed notifications: one incident per exact cause,
  periodic reconciliation catches the missing notification; unrelated candidates,
  scopes and approvers remain separate.
- Manager is offline or authority revoked: deterministic monitoring persists
  the wait and routes only to a currently authorized resolver; it cannot assume
  approval, impersonate a manager or launch a duplicate executor.
- Quota/auth failure or an uncertain live executor: persisted hold/backoff and
  guarded recovery remain; repeated incident notices do not create model loops.

Reuse existing event/reconciler, approval-dedup and attention tasks. Contract/API
changes require owned review, revision checks and independent QA; no prompt-only
claim of successful incident handling.

## Source adoption and test/QA handoffs

Provide a supported, attributable path from a legitimate contributor/release
candidate to registered ownership and native exact-candidate qualification.
Bind source and destination identities, immutable SHA, ownership/path scope,
required contributor consent and actual engine/adapter provenance. Preview
current branch/worktree/assignment/guard/lease state before any mutation.

- A clean exact owner-approved release candidate can be transferred or composed
  through the supported route and produce fresh native check receipts, independent
  review and serialized integration without a manual branch reset.
- Dirty destination, active task/check/lease, stale source or changed approval
  refuses/defer with an exact remedy and responsible owner; preserve every byte
  and unique commit. Installation activation never counts as canonical landing.
- Interrupted/repeated adoption is idempotent; preserve original lineage and
  failure evidence. Never fabricate receipts or silently change scope.
- Test handoff has a named test implementer, exact permitted paths/scenarios,
  candidate/revision binding and reviewer. Approved additive tests can proceed
  without repeatedly seeking the same consent; new scope needs a new decision.
- QA rejection returns an actionable issue to a named owner. QA acceptance is
  exact and independent, never a blanket authority or weakened test criterion.

Extend the existing candidate-source qualification and authority services, not a
parallel landing queue. Agree owned interfaces and contribution boundaries once,
then validate them mechanically. Preserve one active assignment per specialist.

## Additive acceptance for existing Chat and evidence tasks

Applies to TASK-owner-agent-chat, TASK-console-agent-chat-ui,
TASK-company-evidence-ux and TASK-console-attention-actions. Retain all original
criteria. The installer currently has no owner criterion-amendment API; attach
this owner-approved addendum by durable references, with manager-owned tracked
reconciliation rather than unsupported live task-file rewriting.

- Message status distinguishes queued, delivered/observed, acknowledged,
  action started, decision/result and failed; unsupported stages remain unknown.
- Configurable response expectations show overdue requests and next resolver,
  using deterministic reconciliation without duplicate wakes or owner nagging.
- Explicit permission-denied/provider-unavailable/offline states explain delay;
  measured response latency is not an invented completion-time guarantee.
- Separate process activity from implementing, checking, coordinating and waiting.
  Progress includes timestamp/source and links to exact changes/checks/decisions;
  unavailable evidence is unknown, not idle, success or a fabricated percentage.
- A continuously active agent with an unresolved wait is visibly waiting or
  coordinating; acknowledgements and unchanged status reports never imply useful
  delivery. Display owner interventions and verified integration separately.
- Desktop/mobile/keyboard and stale/reconnected observation scenarios preserve
  current modal accessibility, recipient identity, drafts and approval boundaries.

## Ops responsibility pilot

Provider Runtime is the initial Ops engineering contact, with Work and Integration
and Release collaborating within their existing implementation ownership.
Session Manager retains priority/assignment authority. This request creates no
new role capability, worktree, model choice or overlapping implementation owner.
Manager must arrange eligible task slices without overloading the existing active
assignment. Native temporary helpers stay under their responsible identity and
are used only when supported by the approved runtime policy.

Deterministic monitoring handles routine detection and qualified recovery. Ops
investigates novel incidents, proposes repairs/runbooks and measures recurring
failure causes. Ops cannot self-approve checks, overwrite dirty work, change
product priorities, spend through a paid fallback, or broaden recovery authority.

Review after ten resolved incidents or seven active development days, whichever
comes first. Record investigation vs waiting time, repeat incidents, escalations,
owner interventions, regression/recovery failures and displaced implementation
work. Recommend a dedicated standing Ops specialist only if sustained incident
load crowds out implementation and a distinct ownership/outcome can be shown.
Any new identity follows the existing approved organization-change pathway.

Success means fewer repeated unresolved handoffs and owner interventions without
weaker checks, higher failure rates or unbounded retries. Report the baseline and
observed result; do not claim the organizational change worked from agent count.
