# Rolling continuation without a whole-batch barrier

Owner-requested fix for `TASK-d95e72d0-816d-4fc2-acaf-b73642fd4881`.

The serialized controller reserves and charges each launch before dispatch. It waits for the first pending turn to complete, records its outcome, re-reads current policy/backlog/messages and immediately fills any available slot. A long manager turn no longer prevents other eligible identities from running. The controller lock still excludes competing automatic controllers; pending launches and all observed physical turn guards count toward automatic capacity. Owner-requested manual batches are separate authorization and are not silently included in the daily automatic attempt ledger.

The same approved roster, per-identity mutex, pause, detached state and daily cap remain authoritative. A pause prevents additional launches and never kills an already-started turn. Unknown or failed executor outcomes are not silently retried. Retained crashed guards/controller locks remain fail-closed and require supported recovery.

Successful turns may continue unchanged assigned/in-progress work if recorded dependencies are complete. After two consecutive successful turns leave the same task IDs/revisions unchanged, further unchanged-work retries are held and one durable request asks the Manager to resolve the blocker. New task revisions or fresh messages can justify another bounded turn. This is a conservative no-progress signal, not proof that no files changed or that a task is done; the Manager must inspect evidence. Waiting, blocked, unassigned, completed or unmet-dependency work is not automatically converted into implementation work. Existing one-assignment rules and self-claim policy are not changed.

Resume instructions now request eligible implementation/verification/coordination rather than just a status report. They do not grant additional ownership or approval authority. All output completion remains exact-evidence gated.

Status exposes occupied guard identities and no-progress holds. Installed release and reboot persistence remain unqualified. Existing native pilot service executes this source candidate on its next activation; the daily limit remains 12 automatic attempts, not a token-cost governor.

Eligible identities are ordered least-recently-dispatched within the current UTC day, with the Manager first only on ties. A repeatedly revised specialist task must not consume every freed slot while an eligible peer has never started.

## Visible operating stops

The read-only project observation includes the automatic-turn budget, remaining attempts, exact pause/cap stop, retained capacity guards and current no-progress holds. It never resets the ledger, changes authority or treats declared policy as verified timer installation. No-progress holds are displayed only while the same active task IDs/revisions remain; resolved or revised tasks do not retain stale alerts.

An exhausted automatic allowance appears as an owner policy decision in Overview and as an explicit Fleet status line. Manager-owned no-progress waits remain with the Manager, rather than being falsely routed to the owner. There is no fabricated approval button or silent allowance increase. Manual owner turns are not included in this ledger; token/cost governance remains unknown.

Deterministic acceptance scenarios and anti-cheat notes are in docs/TEST_INTEGRITY.md. Independent live qualification remains necessary; do not close broader event-driven or persistent-operations umbrellas based on this source fix alone.
