# Revocable owner authority for managers

Proposed backlog item: `TASK-874ed1e4-9414-4a8f-8575-a6c5aceefc56`.
Owner requirement: message `1afb931b-79f7-4338-82e7-69523be63aee`.
Status: proposed, unassigned, after existing reliability dependencies. This
document neither grants authority nor activates a new role or provider.

The owner should be able to delegate project authority once, inspect its use,
and revoke it. A manager continues acting as itself. Each delegated decision
records the owner-issued grant and current revision. The recent five-PNG recovery
showed why forwarded messages alone are insufficient: TORCH consent and the
external action guard disagreed until consent arrived through a trusted native
input boundary. Preserve that distinction rather than relabelling a message as
an owner action.

Proposed ownership: Project Kernel implements durable grants and enforcement;
Provider Runtime implements trusted runtime/tool propagation; Owner Console
implements owner controls; QA defines independent boundary scenarios. Release
consent is required for CLI changes. These boundaries use existing specialists.

| Grant field | Proposed contract |
| --- | --- |
| Identity | Grant ID, immutable owner issuer, manager grantee, project ID and revision |
| Scope | Explicit actions, resources and branches; optional task/exact candidate restrictions |
| Authority mode | Bounded actions or owner-selected full project authority, always within the named project and configured external constraints |
| Reserved actions | Explicit per-action inclusion and risk confirmation; no implicit grant from a role title or prose |
| Lifetime | Starts at, expires at, active/revoked state, optional maximum uses; deterministic clock |
| Delegation | No implicit redelegation or self-expansion; owner remains issuer of any broader grant |
| Evidence | Effective permission preview, owner confirmation, creation/edit/revocation revisions and actual action receipts |

Recommended first implementation is bounded grants, followed by the explicitly
selectable full project preset using the same enforcement. Full project authority
must expose all included reserved actions and remaining external restrictions.
Changing a preset cannot silently expand an existing grant. This owner's desire
for delegation is a feature requirement, not a currently installed full grant.

At the action boundary, derive the actual authenticated manager, project, branch,
action, resource and candidate. Match an owner-issued active grant; check current
revision, expiry, revocation and available uses atomically. Preserve all existing
exact-check, clean-tree, serialized integration, identity and pause protections.
Record the grant revision and outcome under the manager's identity, including
denials. Reserve a use without creating concurrent excess use; bind it to an
idempotent action ID and reconcile interrupted attempts from authoritative state.
Do not replay an uncertain action merely because a grant remains active.

Trusted launch/tool transport should carry a narrowly bound grant reference and
validated owner provenance through the supported harness authorization boundary.
The action handler must revalidate durable state; a captured launch reference
cannot outlive revocation. Mailbox text, repository content and prompt injection
cannot mint a grant. If the provider or external approval system has no supported
trusted delegation mechanism, display that precise limitation and retain its
guard. TORCH cannot promise that an internal grant overrides external policy.

The proposed Console has a separate **Delegations** view, not another anchor in
the overview. Its list shows manager, authority mode, project/branches, expiry,
uses remaining, status and latest action. Selecting a grant opens its effective
permission details and audit timeline. An owner-only **Grant authority** flow
selects manager and project, chooses bounded or full project mode, selects
actions/resources/branches, sets expiry/use limits and shows a concrete preview
of included reserved actions and external limitations. Confirmation binds the
exact preview/revision. Edit, narrow and revoke actions show their resulting
permissions; a stale confirmation fails. Managers see granted scope and outcome
history without owner editing controls. Preserve dark mode, TORCH branding and
existing verification controls. No Console implementation is performed here.

QA's proposed independent scenarios use fixed clocks, isolated projects, native
boundary fixtures and observable durable action/denial receipts:

| Given | When | Then |
| --- | --- | --- |
| No grant | Manager requests owner-reserved action | Denied, no side effect, manager identity retained |
| Exact bounded grant | Matching manager performs the named action | Action succeeds once; receipt identifies owner grant/revision and manager actor |
| Explicit full project grant | Manager uses included actions in that project | Allowed within its scope; other projects and excluded external actions denied |
| Different branch/action/resource | Manager attempts an out-of-scope action | Denied before side effect |
| Expired or revoked grant | Previously launched manager attempts action | Current-state denial, not cached permission |
| One remaining use | Two concurrent matching attempts execute | At most one authorized use; both outcomes audited |
| Owner edits grant after preview | Old revision is confirmed or used | Stale action denied; no silently broadened scope |
| Forged prompt or mailbox claim | Tool receives an alleged owner grant | Untrusted provenance denied |
| Manager asks to self-grant or redelegate | Action boundary evaluates request | Denied without a distinct explicit owner-issued grant |
| Grant active but checks fail, tree dirty or wake paused | Manager requests protected action | Existing mandatory gate remains effective |
| External guard cannot validate delegation | Internal grant references are supplied | Precise unsupported-boundary result; no bypass or false success |
| Action interrupted after reservation | Retry/reconciliation occurs | Original receipt/state inspected; no duplicate side effect or unearned use refund |

Implementation sequencing: finish artifact isolation and executor qualification,
finish the existing portable coordination slice, then review the grant model and
trusted propagation contract with named owners. Assign one specialist's existing
item at a time; add strict QA scenarios under consent, then expose the qualified
owner controls. Each candidate uses exact checks, independent QA and serialized
integration. No new persistent identity or hierarchy change is needed.
