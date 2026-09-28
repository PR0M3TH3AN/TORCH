# TORCH remaining work

This is the restart checklist for `rewrite/portable-agent-fleet`. The detailed
state and evidence are in
`reports/audit/completion-audit-report-2026-09-27.md`.

## Next safe implementation task

- [x] Repair the Codex adapter for `codex-cli 0.157.1`:
  - do not combine `--sandbox workspace-write` with `--approve-for-me`;
  - put repository, approval, and MCP options before `exec` when resuming;
  - put resume-specific options after `exec resume`;
  - retain the worktree as the subprocess working directory and explicit
    command scope.
- [x] Repair the Claude adapter for Claude Code `2.1.281`:
  - do not supply or persist a synthetic `--session-id` with `--bg`;
  - mark background creation as requiring runtime-ID capture;
  - parse and validate the manager-assigned ID printed by Claude;
  - retain ownership verification before any stop operation.
- [x] Correct `SCN-claude-adapter`, `SCN-codex-adapter`, and
  `SCN-mixed-runtime` with equally strict boundary assertions. Add the required
  Test Integrity Note documenting this as a spec correction plus stronger
  installed-contract coverage.
- [x] Run focused adapter/lifecycle scenarios outside the sandbox where their
  temporary Git worktrees require it, followed by `npm test`, `npm run lint`,
  `npm run check`, and `git diff --check`.
- [x] Refresh the completion audit with the new exact commit and evidence.

Completed in `d8ab841`; focused scenarios passed 8/8 and the complete suite
passed 61/61 with lint, syntax checks, and diff hygiene also passing.

## Planned architecture follow-up

- [ ] Implement ADR-011: versioned, project-specific organization graphs and
  owner-approved hierarchy changes. Extend Fleet assessment to detect
  sustained coordination pressure, distinguish role needs from process or
  specialist changes, and create deduplicated proposals for the owner. Then add
  a gated role schema, impact plan, promotion path, bounded pilot, success/stop
  measures, and reversal before enabling Program Directors, Fleet Operations
  roles, or domain leads. Preserve direct peer communication, single backlog,
  implementation ownership, active work, and explicit runtime launch. Do not
  copy COMBATRIG's proposed hierarchy as the default.

## Owner-authorized qualification still required

- [ ] Run a bounded Session Architect call and one live Claude/Codex
  multi-domain coordination/resume scenario with a fixed provider budget.
- [ ] Install and reverse the user-systemd scheduler, verifying one real
  dispatch and its receipts.
- [ ] Install an accepted TORCH version in user-local versioned state and use
  its stable launcher to manage this source checkout.
- [ ] Resolve COMBATRIG's 56 ownership/exclusion blockers, then separately
  authorize an import/cutover trial. Do not mutate COMBATRIG beforehand.
- [ ] Publish the package and deploy the public website only under explicit
  release scope.

## Preserved boundaries

- Legacy branches remain `legacy/nostr-torch` and
  `legacy/development-network-v2`.
- Do not add, edit, or remove the pre-existing untracked
  `test-torch-config-host-uQKdqL/` fixture.
- Do not push, publish, deploy, install persistent services, consume provider
  quota, or mutate COMBATRIG without renewed authorization.
