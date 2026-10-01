# Kernel generated artifact recovery evidence

Task: `TASK-bounded-routine-coordination`. Candidate:
`8350e47b0f92f7d41454a8e9a1b59e645b95eefe`.

The formerly missing clean baseline is independently verified from public native
tool records. This establishes provenance for a new narrow QA disposition
decision. It does not qualify the manual dashboard run or authorize restoration.

Only `custom_tool_call` and `custom_tool_call_output` records were selected from
Kernel's rollout. No private reasoning was retained. The relevant observations:

- `call_CjQXVLpBQ9DTuVAQSnqdTdzE`, 2026-09-30 23:59:57.790 through
  2026-10-01 00:00:01.130 UTC: guarded convergence reported no blockers, produced
  the exact candidate, and Git status showed only `## torch/project-kernel`.
- `call_4dAbxQLYOxEQe9ulBAKKBJNu`, 00:00:43.426 through 00:00:55.838 UTC:
  direct `npm run test:dashboard` exited successfully. This remains an
  unqualified manual run without an exact TORCH receipt.
- `call_lhYMUOPWggxVMwLKOpp38rn0`, 00:01:05.097 through 00:01:14.066 UTC:
  the candidate was unchanged and exactly the five known dashboard PNGs were
  modified.

Manager rechecked all five current byte hashes against the preserved external
archive and checked the recorded baseline hashes against the candidate's tracked
blobs. All matched. Source files were not changed. QA independently confirmed
the same provenance in message `42f16001-4bae-48da-b199-3e48b872f840`.

The retained local evidence is outside Kernel's tested tree:

- [Original byte archive manifest](../../artifacts/TASK-bounded-routine-coordination/kernel-8350e47-generated-dashboard/manifest.json)
- [Supplemental public pre-run proof](../../artifacts/TASK-bounded-routine-coordination/kernel-8350e47-generated-dashboard/pre-run-provenance.json)

The original manifest records what was known when it was written; the supplement
adds the newly located proof. Raw artifacts are ignored by Git and retained
locally; remote durability is not claimed.

Approval `c2a1702b-2042-444c-9472-6d277a2017b6` remains rejected. The new request,
`406ff30e-b317-4733-b39e-f63c9a57506d`, is addressed to QA and limits proposed
restoration by Kernel to these paths, after rechecking HEAD, current/archive
hashes, and the exact dirty-file list:

- `reports/design-system/torch-dashboard-activity-review.png`
- `reports/design-system/torch-dashboard-check-evidence.png`
- `reports/design-system/torch-dashboard-operation-outcomes.png`
- `reports/design-system/torch-dashboard-owner-briefing-desktop.png`
- `reports/design-system/torch-dashboard-owner-briefing-mobile.png`

The task remains blocked on recovery and exact check qualification. Restored
cleanliness would not supply a dashboard receipt. The accepted artifact
dependency remains unlanded; no peer merge, canonical landing, provider start,
baseline change, cleanup of other files, or gate waiver was performed.

At the closing inbox boundary, owner message
`40585506-3561-4644-bc0d-949fd4e4cdde` and QA message
`0316210f-6c0f-474f-83a5-a7651af9f908` established that the attempted QA decision
batch was interrupted. Authoritative approval readback still showed `pending`,
revision 1, with no decision or restoration. Owner requires fresh clarification
before anyone retries, cancels or decides that recovery operation. Manager routed
this hold directly to Kernel. Independent bounded Runtime test consent was sent
separately by QA; it does not grant recovery authority.

The same closing reconciliation retained Runtime candidate
`f4594e9a3767b5e7bc3284b5c81872c6143c0760` as locally improved but not fully
qualified. Owner independently observed bounded code-less error classification
and early thread identity before forwarded SIGTERM; strict product scenarios and
all required exact-commit receipts remain necessary. Console recorded revision 5
as blocked at `13fe10b765736984d02f6bca02f690d63dbb3a64`: the confirmed 390x844
CSS mobile viewport could not be captured because `Page.captureScreenshot`
timed out. DOM geometry is not completed mobile visual evidence.

Fleet evolution and hierarchy assessment support retaining the six existing
specialists while improving consent, preflight evidence and per-action receipts.
No Fleet change or new dispatch was made. Automatic wakes remain paused. Owner
landing approval `2b2dfb35-46ac-4adb-ac14-5680f7a85e80` remains pending; the
automatic approval review rejection was not retried or bypassed.
