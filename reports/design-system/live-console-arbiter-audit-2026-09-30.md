# Live Console arbiter usability audit

## Evidence and scope

Owner requested direct inspection of `http://127.0.0.1:4174/console` and a report
to Session Manager. Inspected the real installed workspace in the connected Brave
browser using interactive navigation, DOM observations and actually viewed
viewport screenshots. No live task, approval, profile, release or message was
mutated through the browser. Expanded the request composer and one incomplete
check receipt only. Screenshots were viewed in this audit conversation; no new
artifact catalog or saved screenshot files are claimed.

Visited all ten navigation entries: Overview, Briefing, Flow watch, Work,
Progress, Fleet, Conversations, Organization, Evidence and Release gates.
Temporary narrow viewport was reset afterward. Desktop DOM viewport was
1253×685. Requested mobile override 390×844 produced reported CSS viewport
433×938 in this browser; responsive measurements below use the reported values.
No full keyboard audit, draft/refresh experiment, approval submission, empty/error
simulation or hidden Operations panel coverage is claimed. Those remain the
assigned UI agent's coverage requirements.

## Prioritized findings

### P1: one document makes monitoring impractical

Desktop document height measured 50,288 pixels. Work occupied 36,662 pixels,
Conversations 5,723 and Organization 2,931 at the observation point. Navigation
changes URL fragments and scroll position rather than opening focused views.
The masthead/project/freshness controls scroll away on lower sections. Current
nav styling exists, but every navigation link lacked `aria-current`.

Use addressable separate screens with persistent project context. Keep Overview
to a concise pulse, real decisions, blockers and recent outcomes. Route detail
links to exact task, agent, check or decision rather than a broad section.

### P1: work-card density dominates the page

There were 43 active tasks, including 41 Queue cards. Narrow desktop kanban
columns wrap IDs and titles heavily and show full long descriptions. Filtering,
saved-view editing and task creation sit above the actual work. At narrow size,
the filter block alone measured approximately 572 CSS pixels, followed by a
horizontally navigated kanban.

Use compact task summaries with a detail drawer/page. Separate proposed backlog
from active work by default; retain one authoritative task system. Put secondary
filters/saved-view editing behind an intentional control. Mobile should offer a
usable list or selected-column view, not require navigating every column.

### P1: attention is opaque and duplicates the same condition

Actual Overview repeated MESSAGE_BACKLOG plus the unacknowledged message count,
and three WORKTREE_PROBLEM entries all said only “Doctor reported a project
condition to review.” Unique commits and manager backlog edits are not equivalent
to a failed merge or missing tree. The Healthy badge can imply more operational
readiness than these conditions justify; the existing doctor threshold may be
valid, but the UI label should describe its narrower meaning.

Implement `TASK-console-attention-actions`: group and deduplicate actual entities,
name identity/branch/reason, distinguish safety gates from routine agent progress.
Offer owner Approve/Reject only for an actual pending owner-addressed approval,
using current revision/evidence preview-confirm checks. Offer exact inspect,
message/review or supported recovery actions otherwise. No blanket dismiss,
peer-message acknowledgement, merge, deletion or publication shortcut.

### P1: conversations is an internal transcript, not owner chat

Two-column entries expose entire long coordination instructions. There is no
agent-thread picker, compact subject/task grouping or focused reply experience.
The expanded installed request composer displayed “Install a reviewed Fleet
before sending owner requests” while identity options were populated and Preview
request was present. This contradicts the installed workspace state. Existing
request composition is not a native owner reply channel or automatic wake.

Implement `TASK-owner-agent-chat` with truthful per-agent threading, delivery and
reply states. Keep engineering message detail expandable; show concise relevant
summaries first. Fix stale placeholder status from actual capability state.

### P2: fleet, ownership and organization repeat technical metadata

Fleet repeats runtime/model/profile text and mixes implementation paths with
session monitoring. Organization cards repeat peer links and large owned-path
lists; the QA role shows an extensive historical report-file inventory. These
are useful audit details but poor default monitoring content.

Use a compact agent table/list showing work, state, last evidence, blocker and
chat/open actions. Put ownership paths and authority into agent detail. Use an
actual hierarchy/relationships view for Organization with a details inspector.
Do not replace observed presence with inferred process liveness.

### P2: briefing and progress do not provide a quick owner outcome

Briefing was unpublished and instructed the owner to run digest build/publish CLI
commands. Progress showed feature/milestone group totals but did not provide an
obvious exact-task drilldown. Preserve its good distinction between task progress
and verification/release readiness.

Provide permission-aware local generate/review/publish flow when supported and
link progress groups to filtered work. Do not send notifications or publish a
release as a side effect of preparing a local briefing.

### P2: evidence is honest but recovery navigation is weak

Expanded test-dashboard receipt correctly showed incomplete,
worktree-changed-during-check, exact SHA and missing frozen/condition evidence.
This is valuable and must remain strict. Artifacts are not connected yet;
integration/delivery records are empty and correctly avoid implying deployment.
Flow watch still said timer installation not verified despite the earlier
host-qualified timer; review how operational evidence reaches this snapshot,
rather than merely removing the warning.

Add links from an incomplete check to its task, author, candidate and blocking
condition. Show the reviewed next step without turning “retry” into an automatic
repeat of uncertain effects. Place receipts and advanced operational detail on
the relevant screen, not below every unrelated workflow.

## Proposed information architecture

- Overview: concise project outcome, decisions, blockers, recent events.
- Work: active work; compact proposed backlog; filters and exact task detail.
- Agents: state/work/waits, per-agent chat and profile/ownership detail.
- Pipelines: conditional project-defined flows, deliverables and stage history.
- Evidence: checks/artifacts with exact task/commit links and review actions.
- Releases: integration, delivery and separately authorized recovery.
- Organization / Settings: hierarchy, ownership, operations and configuration.

Briefing may be accessible from Overview; advanced operational panels should have
their own destination. Retain dark mode and original TORCH mark. Avoid filling
every view with duplicate cards or decorative labels.

## Implementation acceptance recommendations

1. A navigation action displays only its focused workspace, preserves project
   identity/freshness, and supports addressable reload/back/forward behavior.
2. Forty-plus proposed tasks do not make Overview or agent conversations taller;
   compact cards and bounded/paginated detail preserve all underlying records.
3. Attention is entity-specific and deduplicated, with authority-aware actions
   and unchanged stale-preview/revision/evidence safety checks.
4. Installed request status derives from current capability, not leftover loading
   copy. Per-agent threads remain readable after reload and provider changes.
5. Narrow/mobile monitoring reaches work and actions without a full-screen wall
   of filters; current navigation is accessible via focus and `aria-current`.
6. Independent browser scenarios verify navigation, refresh/drafts, mobile,
   pending approvals, wrong approver, incomplete checks and failed launches.

This report is audit evidence and a proposal, not implementation qualification.
