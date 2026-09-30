# TORCH first real installation and startup

## Outcome

The tool is installed into TORCH itself. The accepted alpha.0 engine and stable
launcher were activated, six specialist domains plus Session Manager received
isolated worktrees, and ChatGPT-authenticated Codex turns ran for Owner Console
(Luna/high) and Session Manager (Sol 6.1/high). The specialist sent a durable
message; the manager acknowledged it and sent a reply. Both durable runtime IDs
were captured. Empty backlog and idle are preserved; no development dispatched.

This is an installation/communication smoke test, not full release qualification.
Both sessions reported a worktree CLI binding problem rather than bypassing it.
No provider API key was read or installed. No pushes, deployment, COMBATRIG
changes, persistent host timers or automatic claims were enabled.

## Configuration

- Project ID: `3dc11932-6e3c-42aa-9a8a-ca7b8f818b54`.
- Launcher: `/home/user/.local/bin/torch`.
- Project state: `.torch/` plus XDG-local project history.
- Worktrees: `/home/user/TORCHWorktrees/3dc11932-6e3c-42aa-9a8a-ca7b8f818b54/`.
- Session Manager: `gpt-6.1-sol`, high.
- Kernel, Runtime, Work/Integration and QA: `gpt-5.6-terra`, high, not launched.
  Interpreted "Tera" as the account's exact Terra model; owner clarification
  can change those project profiles without code/global-settings changes.
- Owner Console and Release/Self-host: `gpt-6-luna`, high.
- Proposed domain leads remain inactive; this was not a two-domain-manager trial.
- Dashboard: `http://127.0.0.1:4174/console`, localhost only. HTML and actual
  `/api/snapshot` returned HTTP 200 with installed project identity.

The protected fixture is intact. A reversible anchored `.git/info/exclude`
entry keeps it outside ownership and clean-checkout scheduling. No tracked
global ignore or user-file deletion was used. Initial `.torch` checkpoint:
`2a8ec35dac1c4b603297176fd1a8dcce36300d2b`.

## Real friction and its cost

1. PATH selected Codex 0.158.0 while this parent session used bundled 0.159.2.
   The older child rejected `gpt-6.1-sol` with an account-support error. One
   failed launch and a diagnostic replay preceded the correct executable retry.
   This did not establish a subscription-wide lack of Sol access. Current CLI
   0.159.2 subsequently ran the requested model successfully.
2. Startup errors omit Codex JSON stdout events. The displayed error was a
   global Vercel MCP authentication failure, hiding the actual model rejection.
   Manual capture of provider stdout was required. Unrelated MCP noise also
   appeared in successful startup; it is not TORCH's communication server.
3. `torch brief` from both managed worktrees returned
   `LOCAL_STATE_METADATA_MISMATCH`. Bound MCP queries/identity/ownership/inbox/
   backlog worked, and the agents correctly reported the failure and stopped.
   Fix must prove canonical-root/worktree membership rather than relaxing checks.
4. Generated `.torch` state requires a local commit before worktree creation;
   provisioning then changes the tracked installation manifest. This requires
   another checkpoint. Current docs don't guide that complete handoff clearly.
5. `doctor` is healthy despite an unavailable requested model or worktree-brief
   failure. Installation integrity is not live startup/model qualification.
6. Manager should not receive specialist-only next-task instructions. In this
   smoke policy the manager query was correctly refused; separate role-specific
   startup steps would avoid an unnecessary error.

The plumbing works, but setup still requires engineering knowledge. It is not
yet an effortless end-user onboarding experience. The above incidents are in
`docs/TODO.md`, with distinct evidence and no claims of fixes not yet delivered.

## Provider-update improvement implemented during the first run

Owner explicitly requested current provider harnesses at install/startup.
New update preflight stages exact versions into TORCH-owned prefixes, verifies
version and parser startup, serializes updates, retains prior installs, and
selects absolute executable paths. Login/global settings are unchanged.
Automatic policy is owner-approved and per configured runtime, 24-hour freshness;
offline previews and failed refreshes do not launch stale providers silently.

Actual official-registry install/parser receipts:

- Codex `0.159.2`.
- Claude Code `2.1.285`.
- Pi `0.99.1` via current `@earendil-works/pi-coding-agent` package.

Receipt: `/tmp/torch-first-run-provider-update-result.json`. All three verified
`--version` and `--help`. Only Codex has live session qualification in this run.
Current Pi extension/flags and Claude lifecycle remain separately unqualified;
a newer binary doesn't establish adapter compatibility or model access.

Four new deterministic scenarios exercise official allowlist, exact executable,
fresh-cache/no-network behavior, fail-closed refresh, locking, tamper detection,
path safety and real CLI policy/startup boundaries. Existing self-host packaging
scenario now also excludes tracked project `.torch` state from engine candidates.
All 39 source acceptance groups PASS before checkpoint; installed candidate
qualification is recorded separately after build/activation.

## Pipeline addition: planned, not implemented

Spec section 14.0a now defines versioned optional project production flows,
deliverable instances linked to the existing backlog, pinned artifact/check/
approval lineage, safe rework, explicit waits, and a conditional Console view.
Frontend-design guidance shaped the row-to-detail progression, mobile blocker-
first presentation and evidence hierarchy without changing existing Console CSS.
There is no live pipeline runtime/view yet and no COMBATRIG pipeline alteration.

## Evidence receipts

- `/tmp/torch-real-candidate-build-20260930.json`
- `/tmp/torch-real-first-run-install.json`
- `/tmp/torch-first-run-model-list.json`
- `/tmp/torch-first-run-worktrees.json`
- `/tmp/torch-first-run-manager-start.json` (old CLI failure)
- `/tmp/torch-first-run-manager-diagnostic.json` (actual model error)
- `/tmp/torch-first-run-manager-current-cli-start.json` (Sol success)
- `/tmp/torch-first-run-luna-start.json` (Luna success)
- `/tmp/torch-first-run-alpha1-final-acceptance.json`

No cache savings, token cost or active-time metric is claimed: no attributable
runtime usage samples have been submitted. Pipeline metrics remain a design.
