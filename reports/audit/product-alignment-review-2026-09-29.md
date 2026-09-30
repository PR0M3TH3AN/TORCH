# TORCH product alignment review

Reviewed the conversation requirements, current specification and TODO,
dirty working tree, runtime installation/design boundaries, provider adapters,
backlog loop, integration serialization, resume instruction injection, and
public/dashboard surfaces. This is a bounded implementation review, not a
claim of release qualification or a line-by-line security audit.

## Product intent

TORCH is a portable project development fleet. A repository and selected
specifications shape specialist responsibilities. Each identity can use a
different local runtime/model. Specialists keep focused context, communicate
directly, and work from one durable backlog. Coordination roles can be proposed
as integration work grows. The owner uses the actual project dashboard to
inspect progress, evidence, agent communication, approvals, and profiles.
TORCH should eventually develop TORCH through its installed stable engine.

## Corrected findings

1. **Dashboard demo was a separate miniature implementation.**
   `site/demo.html` and the prior demo script implemented only four static
   panels with their own controls. The owner's correction requires the actual
   tool. The landing link now opens `console.html?demo=1`; the real Console
   markup and renderer use an in-memory sample transport. Tasks, priority,
   requests, image feedback, profiles, approvals and organization review work
   through the same UI. The link label is `View dashboard demo` and the demo
   title is `TORCH Dashboard`. The former demo URL redirects to that view.

2. **Generated runtime assignments prevented Codex-only installation.**
   `src/kernel/domains.mjs` assigned Claude to every generated domain, and
   installation required all those assignments even when the owner selected
   only Codex. Generated roles now use `default`; installation resolves them
   to its chosen adapter, reports it in the dry-run, and supports
   `--default-runtime`. Explicit per-role assignments remain intact. The
   existing no-selection Claude default remains for compatibility.
   The same hard-coded fallback also existed in dynamic domain creation and
   merge/split proposals. Those now resolve omitted or inherited runtime
   choices from the installed project's default, covered by a Codex-only
   domain-proposal scenario.

3. **Session Architect validation excluded Pi/custom adapters.**
   A two-provider whitelist conflicted with the registered adapter model.
   Pending designs now validate adapter identifier syntax. Installation still
   checks support and plugin trust before creating project state. This does
   not add a new AI provider invocation pathway to the architect itself.

4. **Work board used a state absent from the backlog model.**
   The Queue lane matched `open`, but `src/backlog/service.mjs` defines
   `ready`. Real ready work fell into Other. The shared Console now puts
   `ready` work into Queue, exercised in the browser scenario.

## Remaining issues and limits

2026-09-30 conclusion follow-up: separate owner-confirmed CLI adoption and
reversal now use fresh plan hashes binding current commit, graph, owned pilot,
manifest, latest review and active work. Adoption requires the latest supporting
review; reversal restores prior relationships at a new revision and retains
implementation owners, identities, actual worktrees, assigned task history,
messages and schedules. Obsolete schedules remain for explicit review. Failed
Git commits restore scoped files/index, while a committed receipt whose local
audit transaction failed reconciles on the same owner confirmation without a
second commit. Confirmed replays are idempotent. The full isolated acceptance
gate passes all 38 groups with test/lint/syntax exit 0 and no signal/error;
pilot reversal evidence is explicitly required. Live qualification and Console
conclusion controls remain open. No real provider, fleet or timer was started.

2026-09-30 hierarchy lifecycle follow-up: the readiness audit found the
end-of-pilot comparison path missing. `hierarchy-review-pilot` now records
durable, audited, deduplicated baseline comparisons and criterion assessments;
`hierarchy-pilot-reviews` reads the history. It requires the active owned pilot
record, exact metric/criterion coverage and matching units. Observations are
explicitly reviewer-reported measured/qualitative/unavailable evidence. Adoption
recommendations require the configured window to finish and all success/stop
criteria to support that recommendation. No graph, tracked files, runtime or
proposal lifecycle state changes. Owner-confirmed adoption, safe reversal and
live pilot qualification remain open. The focused hierarchy suite passes
12/12, and the strengthened real isolated acceptance gate passes all 38 groups
with test/lint/syntax exit 0 and no signal/error. Pilot review evidence is now
required by that gate; missing-marker regressions reject its absence.

2026-09-30 follow-up: the manager wake policy finding below has been corrected
in implementation. The owner can explicitly select count-limited wakes for
subscription/local runtimes while retaining enforced USD-hard-cap mode when
supported. Real built-in adapter planning, simulated invocation, UTC budgets,
pending delivery recovery, and overlap protection pass the new scenarios.
Live provider/timer qualification remains open. CLI reservation inspection and
owner-attested recovery are now implemented and tested. Recovery requires an
offline manager and explicit stopped-runtime evidence, preserves budget and
message replay guards, and does not launch anything. This is not independent
process-termination proof or evidence of an operational fleet.

- **Manager wakes still need operational qualification.** The original
  mandatory USD ceiling prevented built-in adapters from waking managers.
  Explicit invocation-count mode now fixes that policy mismatch without
  claiming dollar enforcement. Live provider/timer behavior and operational
  qualification of owner-attested reservation recovery remain open. Hard-cap mode continues to
  fail closed for adapters that cannot enforce it; estimates are not caps.
- **Landing differs from COMBATRIG's batch lander.** TORCH serializes authorized
  FIFO integration and requires exact checks after each source owner merges
  current main. Stale siblings return for convergence. Remote publishing is a
  separate owner-confirmed sync. This protects main, but it is not evidence of
  an automatically rebased/merged batch or unattended remote publication.
- **Operational acceptance remains open.** Local fixtures and browser tests do
  not qualify live mixed-provider sessions, persistent timers, COMBATRIG
  cutover, or stable TORCH managing this checkout. The protected untracked
  fixture remains untouched. No fleet, provider session, timer, or remote
  publication was started in this review.
- **Tests need their proper interpretation.** Existing product tests rely
  heavily on source text. The new browser scenario exercises the rendered
  product and rejects live API traffic. Pure demo-state tests prove isolation,
  preview/confirmation and replay behavior; they do not prove backend actions.

## Verification entrypoints

2026-09-30 Console conclusion follow-up: piloting proposals now offer a
separate owner conclusion preview and confirmation through the actual existing
organization UI. Blocked plans receive no token; same-origin loopback checks,
target/operation/action/reason binding, short-lived one-use previews, fresh
service plan hashes and idempotent confirmed replay guard the scoped commit.
Adoption rechecks current calendar maturity, including future-dated report
rejection. API scenarios verify supported adoption and reversal, missing or
altered confirmation, cross-operation token use, cross-site requests, stale
main, and one owner audit. The isolated demo shows blocked qualitative adoption
and confirmed sample reversal without changing agents/backlog or calling live
APIs. Its status explicitly says no real Git commit occurs. The dark preview
interaction was reused and the focused screenshot
`reports/design-system/torch-dashboard-pilot-conclusion.png` was visually
reviewed. Full isolated candidate acceptance passes all 38 groups with
test/lint/syntax exit 0 and no signal/error; both conclusion API markers are
required. Browser and diff checks pass. Live candidate status remains empty,
with no active version or stable launcher. Live qualification and self-host
activation remain open; no real Fleet, provider or timer was started.

2026-09-30 pilot-review Console follow-up: snapshots attach the latest five
review reports to each hierarchy proposal without modifying review history.
The existing dark organization view renders baseline/observed comparison
columns, units, evidence quality, interim/full-window status, criterion
assessments and references. Reviewer-reported evidence and recommendations
are explicitly distinguished from verified facts and owner conclusions. The
actual Console demo includes a qualitative inconclusive sample; Chromium
checks the rendered values, references, lack of recommendation-execution
buttons, responsive layout and zero live API calls. The focused screenshot
`reports/design-system/torch-dashboard-pilot-review.png` was visually reviewed.
Full current-source suite 139/139, browser, lint, syntax and diff checks pass.
Console conclusion confirmations and live qualification remain open; no real
provider, Fleet or timer was started.

2026-09-30 observability follow-up: read-only snapshots now expose manager wake
reservation history and blocking counts without modifying the SQLite records.
The actual Console shows unknown launches in owner attention and schedule
operations, with exact reservation/message references and presence explicitly
separate from process proof. Attention links open collapsed ancestor panels.
The isolated demo includes a sample unknown launch. Chromium verifies rendered
details, navigation, absence of unlocking/restart buttons, mobile layout and
zero live API calls; the focused image is
`reports/design-system/torch-dashboard-manager-wakes.png`. Full regression
137/137, browser, lint, syntax and diff checks pass. No live Fleet or timer
was started. The existing dark interface was preserved rather than introducing
a separate alert/dashboard design.

2026-09-30 acceptance follow-up: the real `runCandidateAcceptance` gate on the
updated source passes all 38 required acceptance groups under disposable
HOME/TMPDIR/XDG isolation. The required evidence map now includes all four new
wake-policy/reservation/recovery scenarios plus unique provider-inheritance
and CLI provider-default scenarios. Regression checks reject each omitted
marker despite green process exits. Gate results are test/lint/syntax exit 0
with no signal or error. This is current-source evidence, not an artifact
receipt or clean-commit qualification. Live read-only candidate status shows
an empty user-local version store, no active version and no stable launcher;
HEAD remains `d31437a4fb255c1e307bbb70ee9513cc1e0bdf4c` with preserved dirty work.

Final current-tree evidence: **full regression suite PASS**, browser scenario
PASS, lint/syntax/diff checks PASS. The existing loopback preview serves the
demo with HTTP 200. These checks do not refresh earlier self-host candidate
acceptance receipts or qualify a stable installation.

- `npm run test:dashboard`: Chromium browser scenario and desktop/mobile images
  in `reports/design-system/`.
- `node --test test/fleet/dashboard-demo.test.mjs`: isolated demo state scenarios.
- Runtime selection scenarios in `test/fleet/kernel-lifecycle.test.mjs` and
  `test/fleet/cli-scenarios.test.mjs` exercise real disposable Git installations.
- Full `npm test`, lint, syntax checks and diff hygiene provide regression
  evidence for the current tree. See the current task handoff for final counts.

Existing legacy branches `legacy/nostr-torch` and
`legacy/development-network-v2` are present. Installed CLI help also recognizes
the Codex create/resume options and Claude's background/resume system-prompt
file options used here; this is parser evidence, not provider execution.
# COMBATRIG frozen-check follow-up (2026-09-30)

Implemented optional project-configured frozen check inputs in
`src/checks/snapshot.mjs` and the existing CheckService. `checks prepare`
captures explicit input paths before resource acquisition, validates a captured
project build-commit marker, and persists the subject. Copies are reflinks or
independent copies, never mutable hardlinks. Queued specialists may commit and
rebuild while waiting; `run-prepared` still verifies and tests the captured
subject and produces evidence only for its original SHA. CLI and identity-bound
MCP expose prepare/list/run/cancel. Resource ownership remains explicit.

Stale markers, unsafe paths/symlinks, policy changes, tampered input copies,
execution exceptions, changed bytes and lost leases fail closed. Normal runs
remove only their exact owned snapshot while preserving source outputs and
receipt manifests. Interrupted running state is retained, not retried or
cancelled automatically. The build marker is project-declared provenance, not
independent build attestation. Executing from a snapshot is not a process
sandbox; project harnesses must avoid absolute live build paths and unrelated
existing servers.

PASS: eleven focused frozen-input/resource/MCP tests; full current-source
candidate acceptance (38 groups with test/lint/syntax); five self-host tests
including missing-frozen-evidence rejection; diff hygiene. Source acceptance
receipt: `/tmp/torch-frozen-checks-20260930-acceptance.json`. No real browser/GPU
qualification, installed candidate, provider session, persistent timer, remote
action or COMBATRIG mutation occurred. The remaining operational lessons are
tracked under `docs/TODO.md` as explicit incomplete work.
# Test-condition receipt follow-up (2026-09-30)

Added optional project-defined condition probes to both live and frozen checks.
Approved shell-free probes return a bounded schema/subject/conditions report.
Preflight rejects wrong build/digest, malformed or missing reports, incorrect
literal conditions and failed probes before measurements. Postflight drift
invalidates green measurement output. Pre/post diagnostic lines and structured
project-reported observations persist in artifacts and durable receipts; an
exit-zero receipt without required condition evidence cannot qualify.

Check services now reload canonical definitions before listing/planning,
prepared execution and exact-pass qualification. Policy-change scenarios edit
the real project configuration rather than an in-memory map, demonstrating that
a previously constructed service refuses changed prepared policy and old
receipt qualification. An initial wrong-subject fixture accidentally aliased
its expected subject; that fixture now uses an independent copy. All rejection
assertions are unchanged.

PASS: thirteen focused condition/resource/self-host scenarios; final isolated
current-source acceptance (38 groups, full tests/lint/syntax); diff hygiene.
Receipt: `/tmp/torch-test-conditions-final-20260930-acceptance.json`.
These are local fixture/contract results, not real GPU/browser harness or
installed-release qualification. The project probe must observe the same
subject as measurements and detect drift through the interval; endpoint reports
are not continuous sensor verification. Dashboard condition/prepared-check
details and live harness qualification remain in TODO. No provider, fleet,
persistent timer, stable installation or COMBATRIG mutation occurred.
# Commit-linked activity follow-up (2026-09-30)

Subsequent owner-digest checkpoint: deterministic read-only Markdown/JSON
generation now uses current tasks, structured approvals, landed requests,
delivery lifecycle/operation receipts and bounded managed Git activity. Owner
attention leads; readable delivery names/versions, unresolved latest outcomes,
recorded shipping versus landing, completed work, blockers, approval decisions
and neglected owner requests follow. UTC windows, section counts/truncation,
missing evidence and unindexed decisions are explicit. Project strings are
escaped. Database reads share a transaction; worktree state is not claimed as
an atomic snapshot or independently verified deployment.

Owner-approved local publication stores report/audit atomically. Enabled-policy
Fleet Operations publication and typed owner-authorized system scheduling use
no external command or AI wake, honor revocation and install no timer. Latest
reports survive reopen and are exposed by CLI, snapshot and GET-only no-store
`/api/digest`. Readable web presentation, external notifications and actual
installed daily cadence remain pending; no second backlog or public publication
was introduced.

Verification: eight focused digest/self-host scenarios PASS; existing
digest/schedule run PASS (14 scenarios before the added receipt-window test).
Final current-source acceptance PASS (38 required groups, test/lint/syntax),
receipt `/tmp/torch-owner-digest-final-20260930-acceptance.json`; diff hygiene
PASS. No stable install, host timer, provider, fleet activation or real deploy.

Subsequent saved-success recovery checkpoint: owner-only preview and explicit
stopped-executor reconciliation now apply a durably saved successful receipt
without executing an adapter. Exact commit/from-state/next-state, latest
successful receipt, current owner authority and unchanged destination settings
are required. New operations store a canonical destination-config hash; additive
migration preserves older receipts and falls back to their full original policy
hash. The parent-running/latest-success crash window is supported. Local
application/event/audit/operation changes are atomic and replay is unchanged;
interrupted recovery rolls back without discarding the external receipt.

Verification: nine focused delivery/self-host scenarios PASS; all 38 source
acceptance groups PASS (test/lint/syntax), receipt
`/tmp/torch-delivery-success-recovery-20260930-acceptance.json`; diff hygiene
PASS. This supersedes the previous confirmed-success-recovery-pending notes.
Actual provider truth, idempotency and executor-stop qualification remain open.
No real deployment, provider, timer, stable install or COMBATRIG change occurred.

Subsequent delivery-attempt checkpoint: each external call now has a durable
operation reservation and pre-execution attempt record. Independent callers
cannot overlap a delivery's effects. Approval remains mandatory; failed receipts
do not advance lifecycle state. Explicit safe-adapter declarations and structured
transient/not-applied failures permit 1–5 bounded attempts, default one, sharing
an idempotency key. Policy drift stops further calls. Thrown/malformed/uncertain
outcomes remain unresolved. Owner-approved executor-stopped not-applied
attestation clears uncertainty for later deliberate action without rewriting
the original attempt or advancing state. CLI and bounded console snapshots expose
records. Successful lifecycle/event/audit/operation application is transactional.

Verification: three focused delivery scenarios PASS; all 38 current-source
acceptance groups PASS (test/lint/syntax), receipt
`/tmp/torch-delivery-attempts-20260930-acceptance.json`; subsequent indentation
cleanup is mechanical. Real provider execution, provider-side idempotency,
confirmed-success local-application recovery, canonical fetch retry and dashboard
detail presentation remain open. No real deploy, timer, provider, stable install
or COMBATRIG mutation was performed.

Subsequent landed-closure checkpoint: opt-in post-landing reconciliation now
requires matching project/target, canonical ancestry, current integration and
specialist checks, task ownership, exact commit, evidence and ready-to-integrate
state. It processes standalone trailers from the submitted tip only. Per-task
locks and normal revisioned completion preserve idempotency. CLI preview/yes
and bound manager MCP provide explicit recovery. A post-landing bookkeeping
failure returns needs-review and audits it without reversing successful Git
landing. Unknown/mismatched tasks remain open. Specialist prompts describe
intent versus authority and require confirmation. Automatic policy defaults
off; no real fleet was launched. This supersedes the earlier closure-pending
statement below; live qualification remains open.

Verification: seventeen focused integration/MCP/self-host tests PASS; final
source acceptance PASS (38 required groups, tests/lint/syntax), receipt
`/tmp/torch-landed-closure-final-20260930-acceptance.json`. Diff hygiene PASS.
Source remains uncommitted and no stable install/provider/timer/deploy was run.

Added a bounded read-only scan of canonical and managed local worktree branch
history. CLI `backlog activity` and MCP `torch_backlog_activity` expose exact
task-ID links, owner-request-first stale findings, coverage, future timestamps,
unknown task references and standalone closure intent. Backlog health includes
activity anomalies without auto-repair. Approved configuration controls the
age/history bounds; task metadata edits do not reset the activity clock.

Incomplete history cannot prove neglect. Commit dates/messages are reported
metadata, not independent proof of substantive work. `Closes:` remains intent:
no message alone bypasses landed-evidence completion. Automatic post-landing
closure, daily review/digest scheduling, durable deployment retry receipts and
dashboard activity remain open. No live provider, fleet, timer, stable install,
COMBATRIG mutation or deployment was authorized or performed.

Focused activity/backlog/MCP tests PASS (18 tests). Full current-source
acceptance PASS (38 required groups, test/lint/syntax); receipt:
`/tmp/torch-task-activity-20260930-acceptance.json`. Diff hygiene PASS. This does
not qualify an installed candidate or real provider/browser operation.

# Specialist self-claim follow-up (2026-09-30)

Added optional canonical `backlog.self_claim` policy with explicit identity
allowlist; default/omitted policy is disabled. CLI preview/confirmation and
bound MCP plan/claim resolve active work before selecting explicitly routed
ready tasks with complete dependencies. Selection honors existing priority,
then creation time/ID. Claim histories/audits name the specialist; no fake
manager identity or acknowledgement-only assignment message is generated.

Claim readiness blocks dirty/wrong-branch worktrees, Git operations, active
guards, prepared/running checks, held/waiting resources, unresolved named
approvals and unfinished integration. Existing assignments remain observable
after new-claim permission is revoked. Ordinary transitions cannot spoof the
private self-claim authorization. All transitions into active assignment states
now use the same global assignment lock and busy check, closing a blocked-task
reactivation loophole that could otherwise produce a second active item.

PASS: twenty focused backlog/MCP/self-host tests and final current-source
acceptance (38 groups, full tests/lint/syntax); diff hygiene. Actual concurrent
local processes compete for ready work in the race scenario. The initial QA
fixture needed a second real test surface to produce its analyzed QA identity;
the original rejection assertions were retained. Strict MCP catalog ordering
was fixed in production, not loosened in tests.

The new missing-evidence regression also exposed substring matching in the
candidate verifier: a longer self-claim scenario ID could satisfy a missing
shorter ID. Verification now tokenizes exact scenario IDs. No acceptance
requirement was removed. Final receipt:
`/tmp/torch-selfclaim-final-20260930-acceptance.json`.

These results qualify local mechanics, not model compliance with the new
exception-only communication/per-item refresh guidance or live autonomous
settle/claim operation. No provider, fleet, timer, installation, remote action
or COMBATRIG mutation occurred. Commit-linked progress/closure and other
operational lesson gaps remain tracked in TODO.

# Owner-briefing dashboard checkpoint (2026-09-30)

The actual Console and isolated demo now share an escaped, read-only owner-digest
renderer. Owner decisions come first, then deployment state and expandable
shipping, integration, decisions, blockers and coverage evidence. Missing,
stale, future-clock and partial reports are labeled; raw Markdown is not executed.
Live demo approvals do not rewrite a previously published briefing.

PASS: all 38 source acceptance groups (tests/lint/syntax), receipt
`/tmp/torch-owner-briefing-final-20260930-acceptance.json`; real Playwright demo
desktop/mobile interactions with zero live API calls; diff hygiene. Screenshot
review led to a mobile sticky-navigation anchor-spacing fix. Resize measurements
wait two animation frames for responsive layout; strict width assertions remain.
Screenshots: `reports/design-system/torch-dashboard-owner-briefing-desktop.png`
and `reports/design-system/torch-dashboard-owner-briefing-mobile.png`.

No agent, timer, installation, external notification or deployment was started.
Live browser/GPU frozen-input qualification, real delivery adapters, safe fetch
retries, richer queue/activity views and opt-in external notification remain open.

# Read-only check evidence dashboard checkpoint (2026-09-30)

The actual Console and shared isolated demo now expose frozen-input commit and
digest, recorded copy strategy, invalidation reasons and before/after condition
observations through expandable check rows. Unconfirmed running preparations
remain visible without implying executor liveness or offering automatic reruns.
Project-scoped observation supports older databases without migrating them and
does not follow artifact paths. Private capture paths/file inventories are omitted.
Linked capture evidence resolves independently of the bounded preparation list.

PASS: all 38 final source acceptance groups (tests/lint/syntax), receipt
`/tmp/torch-check-evidence-final-20260930-acceptance.json`; focused projection and
renderer scenarios; real Playwright demo desktop/mobile checks, zero live API
calls; diff hygiene. Screenshot reviewed:
`reports/design-system/torch-dashboard-check-evidence.png`.
Frontend-design guidance kept the existing dark interface and progressive
disclosure rather than adding another control surface. No existing assertion
was weakened. No provider, timer, stable install, fleet activation, deployment or
COMBATRIG mutation occurred. Actual queued browser/GPU runtime qualification
and richer activity/deployment outcome views remain separate unfinished gates.

# Commit activity dashboard checkpoint (2026-09-30)

Live read-only snapshots now expose bounded managed Git activity using canonical
project policy. Task creation time and originating owner identity survive the
backlog projection. The shared actual Console/demo view shows owner requests
first, separates stale work from unknown history, retains blocked waiting context
and labels closure mentions as intent. Neglected owner requests receive attention
links; no duplicate queue or state mutation was added.

PASS: all 38 final source acceptance groups (tests/lint/syntax), receipt
`/tmp/torch-dashboard-activity-final-20260930-acceptance.json`; real Git and HTTP
snapshot regression; actual Playwright desktop/mobile dashboard checks with
zero live API calls; diff hygiene. Screenshot reviewed:
`reports/design-system/torch-dashboard-activity-review.png`.
Design guidance kept the work board authoritative and used compact progressive
disclosure with bounded text lines. No assertions were weakened. No provider,
timer, installation, fleet activation, deployment or COMBATRIG mutation occurred.
Daily automatic review and non-disruptive live refresh remain unfinished.

# Safe canonical fetch checkpoint (2026-09-30)

Added owner-confirmed `forge fetch plan`, `forge fetch --yes --attempts 3` and
read-only receipt status. The resolved canonical SHA is imported as objects only:
no implicit refmap, tags, FETCH_HEAD, submodule recursion or publication.
Recognized transient transport errors retry up to the explicit one-to-five bound;
authentication/unclassified failures stop. Canonical destination hashes and policy
are refreshed per attempt; execution uses the pinned URL. Raw URLs/error text
are not persisted. Attempt reservations precede execution; terminal state and
owner audit are atomic. Snapshot projection includes the last 20 operations.

PASS: all 38 source acceptance groups (tests/lint/syntax), receipt
`/tmp/torch-canonical-fetch-20260930-acceptance.json`; real disposable bare Git
object import, unchanged refs/worktree, actual CLI confirmation/status,
authentication/exhaustion/policy-change boundaries; diff hygiene. No assertions
were weakened. No real project fetch, remote push, deploy, provider, timer,
fleet start or stable install occurred. Initial head discovery fails closed
without retry. Real network classification and dashboard attempt presentation
remain open; fetch receipts are not release/deploy evidence.

# Recorded operation outcome dashboard checkpoint (2026-09-30)

The shared actual Console/demo now displays bounded canonical fetch and delivery
operation/attempt outcomes, with uncertainty and unconfirmed-running labels.
Owner attention links unresolved delivery actions to the view; no retry/recovery
control was added. Read-only project-scoped receipt projection exposes only
recognized status/classification/effects and TORCH error categories, not arbitrary
references/raw error text. Malformed receipts remain unavailable, adapter success
is not live release proof and object import success is not deployment.

PASS: all 38 final source acceptance groups (tests/lint/syntax), receipt
`/tmp/torch-operation-outcomes-final-20260930-acceptance.json`; nine focused
Console/receipt/fetch tests; real desktop/mobile Playwright demo, zero live API
calls; diff hygiene. Screenshot reviewed:
`reports/design-system/torch-dashboard-operation-outcomes.png`.
Browser testing caught a real mobile heading/status overflow; production CSS
wraps that row without weakening document-width assertions or hiding overflow.
Design guidance kept read-only evidence compact and expandable in the existing
dark interface. No provider, timer, fleet activation, installation, real fetch,
deployment or COMBATRIG mutation occurred. Live adapters and draft-preserving
dashboard auto-refresh remain unfinished.

# Protected live dashboard refresh checkpoint (2026-09-30)

The actual Console and shared demo refresh visible snapshots every 15 seconds,
with pause/resume, a ten-second read deadline and single-flight/coalesced reads.
Explicit newer requests discard stale responses. Hidden views skip polling and
page lifecycle handlers tear down/restart the timer without duplication. Failed
reads retain displayed evidence; unsupported live snapshot schemas are rejected.

Edited/focused controls and active preview DOM remain intact while unrelated
read-only panels update. Retained panels are explicitly labeled potentially old;
existing server-side token/revision checks remain authoritative. Successful
actions release only their own editor. Clean-editor baselines follow fresh
snapshot values, including successive external model changes; matching expanded
details remain open. No preview is reissued or confirmed by polling.

PASS: all 38 final source acceptance groups (tests/lint/syntax), receipt
`/tmp/torch-live-refresh-verified-20260930-acceptance.json`; controlled deferred
read races; actual desktop/mobile browser demo with zero live API calls and a
controlled clock proving draft/preview preservation, independent panel updates,
pause/resume, hidden-state/page-event handling and unrelated-draft survival after
approval. Screenshot reviewed: `reports/design-system/torch-dashboard-live-refresh.png`.
No assertions were weakened or sleeps added. Design guidance kept the existing
dark interface with one small status indicator and pause control. No AI provider,
host timer, installed fleet, deployment or COMBATRIG operation was started.
Native back-cache/background behavior and installed-fleet activity remain
separate qualification work. Next prioritize a fresh specification/readiness
audit before enabling TORCH self-hosting, rather than inferring release readiness
from these source/dashboard gates alone.
