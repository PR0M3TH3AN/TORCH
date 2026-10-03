# Experimental self-host activation — alpha.4.1

## Activated

The owner approved two bounded independent QA turns. Final QA verdict
`f0db9c8e-c2c7-4d60-a4c6-a23567643907` accepted exact source
`b0cab8eca1bc62ee908875dfac441a1b8a655fa0` for experimental active-pointer
activation only. Installed version is `0.1.0-alpha.4.1`; alpha.3 remains available
for rollback. No provider/model settings or daily usage limit were changed.

Real package acceptance: 293 PASS, zero failures/cancellations, four explicit
skips (297 total); syntax and lint passed. Acceptance digest:
`a522c0ac7058cf20187f13a7e9be694f90241e4e5fedff0eea6c8beeb84dd362`.
Receipt lives in the installed version's `.torch-validation.json`.

Isolated installed smoke verified first-use installation, read-only brief and
convergence readers, startup dry-run, alpha.3 rollback, re-upgrade and identical
project configuration, without launching any provider.
Evidence: `/tmp/torch-alpha41-installed-smoke-result.json`.

The existing console and continuation service ExecStart overrides now follow
the validated active pointer. Only the owned console was restarted; the timer's
cadence and budget are unchanged. Live loopback snapshot retrieval succeeded at
`http://127.0.0.1:4174/console`. Installed manager and QA briefs succeeded from
the host. The temporary qualification console on port 4175 was stopped.

## Boundaries and remaining work

- Canonical source remains `93602042eb561d7882549ffe298def4c29e4d1cf` on
  `rewrite/portable-agent-fleet`. Functional changes are committed on
  `release/selfhost-alpha4-20261003`, not canonically integrated or published.
- QA did not approve canonical landing, deployment, publication or fleet resume.
  Registered-source adoption and native exact-commit integration gates remain.
- Browser resource admission changes in the release configuration are not yet
  applied to the canonical project's tracked configuration.
- The historical CLI timeout's cause is not established. Bounded test-process
  concurrency is mitigation, not retrospective qualification of failed checks.
- Collapsed warning cards now retain full accessible modal evidence; uniform
  coverage of every card type and connected live browser review remain open.
- QA's earlier native sandbox brief access failure still needs a native-runtime
  follow-up; successful host readers do not prove sandbox access is corrected.
- The ordinary fleet allowance is unchanged; the current one-day allowance was
  exhausted. No additional specialist turn was authorized or launched.

This record is not a broader release-readiness claim.
