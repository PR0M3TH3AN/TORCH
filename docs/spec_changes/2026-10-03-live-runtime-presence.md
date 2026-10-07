# Live runtime presence instead of stale idle badges

The owner requires active executor turns to be distinguishable from old self-reported idle/offline state. Display is observational, not a new task-state machine or a substitute for authorization.

Each new physical turn guard records a starting phase and Linux process-start token, then enters working immediately before invoking the authorized executor. The read-only observation API validates the exact project/identity guard against a live same-user process with the matching start token. Existing legacy guards additionally require the exact TORCH up identity and canonical working directory. Dead, foreign-user, replaced or unobservable processes are not called active; retained unverified guards display unknown instead of false idle/offline.

An active verified guard overrides idle/offline display with starting/working. Original `reportedState`, `reportedSummary`, task and heartbeat are retained. Waiting/blocked reports remain visible even during a live turn. Guard removal naturally restores the last reported state after completion. No report, task, authority, launch policy, budget or receipt is changed by observation.

On unsupported OS process-observation surfaces, guarded execution remains unknown, not optimistically working. Other platform qualification remains open. Native harnesses with no resident TORCH executor may continue to rely on durable reports; this change does not claim to discover every external runtime process.

The live console pilot must load the source candidate to expose this observation. Updating its owned server does not upgrade the installed distribution or restart running agent turns. Broader startup/launch reservation work remains tracked by `TASK-pilot-starting-presence`.

Test integrity scenarios are recorded in docs/TEST_INTEGRITY.md. No existing expectations or test timeouts are relaxed.
