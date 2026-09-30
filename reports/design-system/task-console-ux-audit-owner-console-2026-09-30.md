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

**Not complete:** mobile screenshot capture, exhaustive keyboard order, empty,
loading, and failed-action states, and task-owned artifact publication. The
browser viewport capability accepted a 390 x 844 override, and DOM navigation
worked, but one viewport screenshot was blank and the next failed with
`Timed out after 5000ms waiting for CDP command Page.captureScreenshot.` I did
not retry that failing mobile capture route. See the dated images under
`artifacts/TASK-console-ux-audit/`; do not treat the blank mobile image as visual
coverage.

## Personally observed evidence

| View | URL fragment | Viewport | Viewed observation / evidence |
|---|---|---|---|
| Overview | `#overview` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-overview.png). “Healthy” appears beside six attention items, including five generic doctor warnings; project facts also show `Clean at snapshot` and `ONE-DISK`. |
| Briefing | `#owner-briefing` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-briefing.png). Empty briefing state gives CLI build/publish instructions. On the first navigation, Work was highlighted while Briefing content was shown; repeated navigation selected Flow watch correctly. |
| Flow watch | `#flow-watch` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-flow-watch.png). Check-in and approval panels sit side by side; timer installation is explicitly unverified and only named approvers can decide. |
| Work | `#work` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-work.png). Filters form a dense block above five board columns; 44 active items make cards narrow and text wrap heavily. |
| Progress | `#initiative-progress` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-progress.png). Feature/milestone summaries and the start of Fleet inventory share one long page. |
| Fleet | `#fleet` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-fleet.png). Session state and ownership inventories sit side by side; repeated runtime/model/profile data and long paths dominate. |
| Conversations | `#communications` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-conversations.png). Long messages fill two columns; an identical owner message appears in both columns. |
| Organization | `#organization` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-organization.png). Three-column role cards repeat reporting/coordination links and show lengthy authority/path descriptions. |
| Evidence | `#evidence` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-evidence.png). Check receipts use a narrow left column with repeated pass entries and large empty space to the right; entries are collapsed disclosures. |
| Release gates | `#delivery` | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-release-gates.png). Integration is “ready” while delivery, fetch, and operation receipts are absent; copy distinguishes landing from deployment. |
| Operations | `#delivery` (expanded disclosure) | 1237 x 677 | [Desktop screenshot](../../artifacts/TASK-console-ux-audit/desktop-operations.png). Expansion reveals Worktrees and Resources; details continue below the viewport. |

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
- **Mobile:** at 390 x 844, the DOM still contained Console content and all main
  sections. `mobile-release-gates.png` is blank (3,157 bytes); the next screenshot
  command returned the exact CDP timeout above. Mobile visual behavior remains
  unverified.

The task-owned images are local browser evidence. They have not been published to
TORCH artifact storage; publication will follow a committed full SHA and a stable
mobile-capture path or a documented partial-evidence decision.

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

Coordinate the 390 x 844 screenshot timeout with Provider Runtime and QA; then
capture navigation views at mobile size and inspect overflow, wrapping, nav
behavior, and density. Continue keyboard order and representative empty/loading/
pending/failed/unknown states, using the isolated demo for state-changing actions.
Publish only task-owned evidence after local commit. Live state stays read-only.
No UI implementation or release is proposed by this audit.
