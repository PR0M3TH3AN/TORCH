# Specialist-only repository bootstrap

The stricter initial ownership guard exposed a baseline planning defect: with no
implementation components, the analyzer added Core owning `**` before creating
evidenced QA or release roles. The generated roster therefore contradicted the
one-primary-owner invariant and could not pass approved-install validation.

`proposeDomains` now evaluates QA and release evidence before using Core fallback.
Test-only projects receive QA; release-only projects receive Release; projects
with both receive both, with disjoint ownership. An empty manifest-only project
still receives Core. Future implementation responsibilities can be proposed and
reviewed through the existing evolution pathway instead of inventing a standing
catch-all implementation agent beside horizontal specialists.

`SCN-bootstrap-specialist-only` first reproduced the defect, then passed across
four real disposable committed repositories. It verifies exact proposed domain
IDs, successful approved-proposal validation and an unchanged Git worktree.
Existing primary-collision rejection was not weakened. The scenario is required
by source candidate acceptance; integrity notes are in `docs/TEST_INTEGRITY.md`.

Verification:

- 23 focused domain-analysis, Architect and kernel-lifecycle scenarios PASS.
- Focused ESLint and `git diff --check` PASS.
- Full isolated source acceptance PASS: 38 required groups, test/lint/syntax
  statuses zero, receipt `/tmp/torch-specialist-only-bootstrap-20260930-acceptance.json`.
- `main` and `legacy/nostr-torch` remain at
  `a46832314f6a32c6636ae8ff672df8c3e67e2672`; the older development-network legacy
  branch remains at `b026a6e6fcd855b9fd158c388629d93f297e486c`.

No source checkpoint, stable install, provider invocation, fleet startup, host
timer, COMBATRIG mutation, push or deployment occurred. The previous six-area
proposal remains a historical pending artifact: source changes invalidate its
binding. Regenerate the commit-bound intake/proposal after checkpoint approval,
rather than approving the stale artifact. Specification section 32 is still not
qualified by source scenarios alone.
