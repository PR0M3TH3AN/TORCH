# Priority Console upgrade: compact cards and agent Chat

Status: owner-approved development requirement; completion is determined by the
authoritative backlog and exact installed/browser evidence, not this document.
On 2026-10-03 the owner promoted TASK-owner-agent-chat,
TASK-console-agent-chat-ui and TASK-console-chat-cards-qualification to urgent.
The fleet is explicitly resumed. Existing runtime safety gates and any subsequent
owner pause still apply.

## Immediate owner-facing milestone

Prioritize a minimal usable Chat: approved coordinator selected by default,
activated-agent selector, durable per-agent history and message composer with
explicit destination and truthful queued/handled status. Session Manager should
assign eligible Console/Runtime/QA contributions without stealing active work.
Keep recovery prerequisites progressing alongside this owner-facing milestone.
If history/composer can safely ship before automatic wake qualification, propose
a named, scoped slice through normal triage; do not silently remove dependencies.
Paused or unqualified messaging may persist but must not trigger provider starts.

## Compact cards and detail modal

Make card-based views a scanning layer rather than full-document readers. Apply
a shared collapsed-height/max-height policy across data types, with consistent
heights within each grid/view and responsive size variants. Do not squeeze tables,
charts or conversations into an arbitrary universal card height.

Show title, state, accountable agent, a two/three-line summary and important
blockers or decisions. Clamp overflowing ordinary content with an explicit
View details action. Critical warnings must remain identifiable and accessible;
provide a concise warning summary and full detail rather than clipping it silently.
Retain sensible quick actions such as approve/reject on collapsed cards, using
existing evidence/revision/preview confirmation and authority checks.

Clicking the card's detail affordance opens an accessible modal with complete
content, evidence, linked conversations/tasks and contextual actions. Nested
action buttons must not accidentally open the modal or trigger another mutation.
Modal content may scroll. Preserve underlying view/filter/scroll and unsent input;
support keyboard access, focus containment/restoration, Escape, labelled headings,
mobile full-screen details and explicit stale/deleted-record states. Refresh must
not replace unsaved edits or apply an action against an obsolete revision.

Start with Work and Needs Your Attention, then cover remaining card-based views
with the same pattern. Do not replace specialist views or create duplicate data.

## Conversational Chat view

Add Chat immediately below Overview in the sidebar. Default to the highest-level
approved project coordinator, currently Session Manager, not a permanently
hard-coded identity. Show an empty/explanatory state if none is configured; never
create or activate an agent to satisfy the screen.

Provide a familiar chronological message stream, composer and selector for every
activated fleet identity. Persistently show Talking to…, identity, role, runtime
availability and a distinct visual accent. Colour is supplementary: labels,
avatars/initials and accessible contrast must also distinguish participants.

Combine durable owner exchanges and publishable inter-agent exchanges involving
the selected agent, preserving sender, recipient, thread/context and causal links.
Clearly distinguish direct owner conversation from collapsible routine fleet
traffic; replying must explicitly target the selected agent or named thread and
never silently broadcast. Do not claim every harness transcript is available.
Reuse existing owner-agent-chat/messages and formal Conversations audit view,
not a parallel conversation database. Include links to tasks, approvals, images
and supporting evidence. No private chain-of-thought or indiscriminate terminal,
secret or private-file exposure.

Stream publishable replies/progress only when the adapter supports it; otherwise
show honest durable-message updates. Expose queued/delivered/being-handled/failed
outcomes accurately: acknowledgement alone does not mean work is done. Preserve
drafts per recipient, history on navigation/reload, reconnect deduplication and
an explicit send destination. New arrivals must not force-scroll a user reading
history. Keep the composer usable on mobile and by keyboard.

Messages can be saved while paused without waking an agent. Future wake-on-message
requires separately qualified reservations, budget, authority and owner-approved
policy. Casual chat does not bypass an explicit approval or grant new authority.
Use clearly labelled demo fixtures with no live APIs, not private fleet history.

## Acceptance and delivery

Use realistic long content, many senders, agent switches, interrupted delivery,
stale records and pending owner decisions. Inspect desktop/mobile/keyboard flows
in an actual browser and retain screenshots. Prove bounded collapsed layout,
complete details, action correctness, focus restoration, preserved filters/drafts,
safe refresh, accurate chat attribution and no launch on paused send.

Existing backlog proposals remain authoritative. New high-priority slices cover
compact cards/details, Chat presentation and independent browser qualification.
Runtime wake safety remains a prerequisite for execution, not a reason to delay
safe read-only/chat-intake UI development.
