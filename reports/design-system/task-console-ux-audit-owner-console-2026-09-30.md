# Console UX audit: Owner Console evidence and coverage addendum

Task: `TASK-console-ux-audit` (in progress, revision 4)  
Audit target: `http://127.0.0.1:4174/console`  
Local checkout: `torch/owner-console` at `f72daadcba9f5d8d47ff4130afc6e39498e7d0d4`

## Current status

This is a partial, evidence-bounded addendum to the arbiter's canonical report,
`reports/design-system/live-console-arbiter-audit-2026-09-30.md` at canonical
commit `7b7c6584b9d315d901133cff828f26f0fcc2003f`. Its measurements remain
attributed to that report, not to this audit.

I resumed the existing Brave browser binding and listed its existing Console
tab; attaching to that tab timed out twice. A fresh agent-created tab in the
same browser session worked. Live Console actions stayed read-only except for
unsent test strings in the local request form; neither string was sent and no
durable Console state was changed.

**Not complete:** mobile coverage beyond Overview, an exact 390 x 844 CSS
viewport, exhaustive keyboard order, empty/loading/failed-action states, and
task-owned artifact publication for every screen. After the owner authorized
one bounded recovery, a fresh Overview tab produced a valid narrow screenshot.
The requested 390 x 844 override measured as 433 x 938 CSS pixels at DPR 0.9;
the prior blank `mobile-release-gates.jpg` and the subsequent 5-second CDP
timeout remain evidence of the failed capture route on the old scrolled tab.
See the images under `artifacts/TASK-console-ux-audit/`.

## Personally observed evidence

| View | URL fragment | Viewport | Viewed observation / evidence |
|---|---|---|---|
| Overview | `#overview` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-overview.jpg). “Healthy” appears beside six attention items, including five generic doctor warnings; project facts also show `Clean at snapshot` and `ONE-DISK`. |
| Overview | `#overview` | 433 x 938 CSS, DPR 0.9 (requested 390 x 844) | [Narrow screenshot](../../artifacts/TASK-console-ux-audit/mobile-overview.jpg). Overview content fits the measured viewport width, but the horizontal nav clips after “Progress” and displays its own horizontal scrollbar. Screenshot dimensions are 462 x 1041 pixels. |
| Briefing | `#owner-briefing` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-briefing.jpg). Empty briefing state gives CLI build/publish instructions. On the first navigation, Work was highlighted while Briefing content was shown; repeated navigation selected Flow watch correctly. |
| Flow watch | `#flow-watch` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-flow-watch.jpg). Check-in and approval panels sit side by side; timer installation is explicitly unverified and only named approvers can decide. |
| Work | `#work` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-work.jpg). Filters form a dense block above five board columns; 44 active items make cards narrow and text wrap heavily. |
| Progress | `#initiative-progress` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-progress.jpg). Feature/milestone summaries and the start of Fleet inventory share one long page. |
| Fleet | `#fleet` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-fleet.jpg). Session state and ownership inventories sit side by side; repeated runtime/model/profile data and long paths dominate. |
| Conversations | `#communications` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-conversations.jpg). Long messages fill two columns; an identical owner message appears in both columns. |
| Organization | `#organization` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-organization.jpg). Three-column role cards repeat reporting/coordination links and show lengthy authority/path descriptions. |
| Evidence | `#evidence` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-evidence.jpg). Check receipts use a narrow left column with repeated pass entries and large empty space to the right; entries are collapsed disclosures. |
| Release gates | `#delivery` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-release-gates.jpg). Integration is “ready” while delivery, fetch, and operation receipts are absent; copy distinguishes landing from deployment. |
| Operations | `#delivery` (expanded disclosure) | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-operations.jpg). Expansion reveals Worktrees and Resources; details continue below the viewport. |

## Interaction evidence

- **Navigation/history:** section links update the hash. Back from Briefing returned
  to Overview, and Forward returned to Briefing. The document remains one long
  page rather than separate routes.
- **Keyboard:** pressing Tab after navigating to Overview moved focus to the
  visible “Open relevant view” link near the bottom of Overview, with an orange
  focus outline. This confirms visible focus for that control, not complete
  tab-order coverage.
- **Manual refresh:** an unsent `AUDIT DRAFT ONLY — do not send.` string in the
  request form survived clicking Refresh.
- **Automatic refresh:** an unsent `AUTO-REFRESH DRAFT ONLY — do not send.` string
  remained after the 15-second update interval; the header reported “Updated just
  now.”
- **Page reload:** the draft was gone after browser reload and reopening the
  request disclosure. In-session refresh preserves it; a full reload does not.
- **Form validation:** Preview request with no recipient kept the form local and
  displayed “Choose an identity and write the request before previewing.” No
  message was sent. The form states that sending adds one durable inbox message.
- **Mobile:** the first viewport override did not apply to a newly created tab;
  the owner-directed fresh-tab capture exposed that mismatch. On the fresh tab,
  the 390 x 844 request measured 433 x 938 CSS pixels at DPR 0.9. DOM rectangles
  showed the Overview section in view and no page-level horizontal overflow
  (`documentWidth` 416, viewport width 433), while the visible navigation itself
  had a horizontal scrollbar. The one authorized fresh-tab screenshot is
  `mobile-overview.jpg` (462 x 1041 image pixels). The earlier
  `mobile-release-gates.jpg` remains blank (3,157 bytes), followed by the exact
  CDP screenshot timeout; it is not visual evidence of that view. Other mobile
  sections remain uninspected.

Selected screenshots are registered in private TORCH artifact storage with task,
session, and commit provenance:

| Image | Artifact ID | Commit |
|---|---|---|
| Desktop Overview | `d4c3bd6c-92b8-4791-9a3b-56c636bd6848` | `e0637f8255b79401fb483dddf3fe8d602aae687c` |
| Desktop Work | `703126cb-31b9-47ad-ba57-73d5f873b754` | `e0637f8255b79401fb483dddf3fe8d602aae687c` |
| Desktop Conversations | `c81acd53-da4e-4113-b5a8-ea3c75b0ac16` | `e0637f8255b79401fb483dddf3fe8d602aae687c` |
| Desktop Operations | `472d28b8-31f7-4130-abde-88f82c582970` | `e0637f8255b79401fb483dddf3fe8d602aae687c` |
| Desktop keyboard focus | `9e93f19d-f826-4d93-8ef7-c4a2474cf3bf` | `e0637f8255b79401fb483dddf3fe8d602aae687c` |
| Blank mobile capture (failure evidence) | `3bc724b8-a22f-4f93-8629-eec92ce06ce3` | `e0637f8255b79401fb483dddf3fe8d602aae687c` |
| Fresh-tab narrow Overview | `6d7848d9-a679-4005-8a5a-e5d8eb7d67de` | `412643da93df7df9e2da7a79cd2fd45b945decc0` |

The arbiter report provides the broader measured baseline: 50,288 px desktop
document, Work 36,662 px with 43 active tasks and 41 queue cards, Conversations
5,723 px, Organization 2,931 px, and a roughly 572 px narrow-screen filter
block. These are attributed to the arbiter report, not measurements from my
incomplete pass.

## Focused workspace proposal

Use separate, reloadable destinations with a persistent project/freshness
header and a concise overview. Suggested destinations:

- Overview: project outcome, owner decisions, blockers, recent events.
- Work: active tasks and a separately filtered proposed queue; compact rows
  open exact task details.
- Attention: one card per underlying issue, with identity, branch/path, cause,
  severity, and only actions supported by current authority.
- Agents: compact state/work/wait list; agent detail owns chat, profile, and
  implementation ownership.
- Evidence: checks and artifacts linked to task, author, candidate commit,
  and blocking reason. Preserve incomplete receipts as incomplete.
- Operations: resource/queue/timer and lifecycle evidence on its own screen.
- Organization and Releases: relationship/authority details and the separate
  integration/delivery gates.

Keep the TORCH mark, dark mode, explicit approval previews, revision/evidence
checks, and honest unknown/incomplete states. Include the owner's requested
`TASK-console-attention-actions`: Approve/Reject only for an actual
owner-addressed approval; warnings should open the exact task, thread, or
worktree review. Deduplicate message counts and cards; do not add dismiss,
mass-acknowledge, merge, cleanup, or publication shortcuts.

## Measurable implementation acceptance criteria

1. Each primary destination has a distinct addressable URL. Reload, Back, and
   Forward restore the expected view while retaining project identity and
   freshness context.
2. At 390 x 844 CSS px, primary destinations have no horizontal page overflow;
   work is a readable list or selected-column view, not a forced full-board
   carousel. Secondary filters do not consume the first 572 px of the view.
3. Keyboard-only users can reach every primary destination and action, see focus,
   and identify the current destination through an accessible current-page state.
4. A unique underlying attention issue appears once. Labels name the affected
   identity and branch/path where available; approval actions remain hidden or
   disabled for non-owner requests and use existing preview/revision/evidence
   confirmation.
5. Automatic polling, explicit refresh, and route changes preserve an unsent
   draft. A controlled failed or interrupted action displays pending/error/
   unknown accurately and never announces success without a receipt.
6. Evidence links resolve to the exact task, candidate commit, author, receipt,
   and blocker. A dashboard check that changes tracked files remains incomplete
   even if its process exits zero.
7. Overview and agent lists stay compact as task/message counts grow; long
   descriptions and message bodies open in contextual detail views. Duplicate
   message cards are absent across recipient/group projections.

## Next evidence needed

Coordinate the capture behavior with Provider Runtime and QA. If a later task
authorization permits more mobile captures, inspect every navigation view at an
exact 390 x 844 CSS viewport for overflow, wrapping, nav behavior, and density.
Continue keyboard order and representative empty/loading/pending/failed/unknown
states, using the isolated demo for state-changing actions. Publish only
task-owned evidence after local commit. Live state stays read-only. No UI
implementation or release is proposed by this audit.
