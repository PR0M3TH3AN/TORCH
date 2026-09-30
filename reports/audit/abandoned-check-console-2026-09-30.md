# Abandoned-check cleanup visibility — 2026-09-30

Check recovery now records cleanup pending before attempting owned disposal, then
persists its outcome. A process interruption before outcome persistence remains
conservatively pending. Reopening shows recorded cleanup state; explicit replay
can update it without another authority audit. A no-op replay preserves metadata.

The project-scoped read-only snapshot omits input paths, process IDs, owner evidence
and private actor metadata. It supports databases without recovery columns and
malformed/oversized records without migrating or inspecting their artifact paths.
Abandoned checks remain visible in the actual shared Console/demo evidence rows.
Completed, pending and unconfirmed cleanup are distinct, and executor termination
is explicitly owner-attested rather than automatically verified. No recovery or
retry controls were added.

Verification:

- 12 focused projection/demo/resource/recovery scenarios PASS (two browser
  qualification scenarios deliberately skipped in this focused Node run).
- Actual Chromium dashboard demo desktop/mobile/control-refresh checks PASS,
  zero live API calls. Expanded cleanup evidence was visually inspected at
  `reports/design-system/torch-dashboard-check-evidence.png`.
- Full isolated source acceptance PASS: 38 groups, test/lint/syntax; receipt
  `/tmp/torch-abandoned-check-console-20260930-acceptance.json`.
- Focused lint and diff hygiene PASS.

Frontend-design guidance kept the existing dark palette, typography and expandable
evidence-row layout rather than adding competing dashboard chrome. No agents,
host timers, stable installation, deployments or COMBATRIG changes occurred.
Browser-descendant interruption and other-platform recovery remain unfinished.
