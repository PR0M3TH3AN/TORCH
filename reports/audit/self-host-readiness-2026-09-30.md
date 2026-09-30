# TORCH self-host readiness

Later refresh: `readiness-audit-2026-09-30.md` and
`self-host-roster-review-2026-09-30.md` supersede the intake counts below.
The latest baseline snapshot has 15 candidate domains, 13 unassigned components
and 41 coordination boundaries. A six-specialist consolidation passed semantic
validation with zero unassigned analyzer components, but subsequent source fixes
make that temporary proposal stale. The original 05:04 snapshot remains historical;
no proposal has owner approval. Fresh read-only candidate status still shows
generation zero, no installed/active version and no stable launcher; candidate
planning still refuses dirty source. Regenerate intake after the approved checkpoint.

## Scope and current evidence

This is a pre-install review, not installation or live fleet qualification.
Read-only checks on 2026-09-30 observed:

- Branch: `rewrite/portable-agent-fleet`.
- HEAD: `d31437a4fb255c1e307bbb70ee9513cc1e0bdf4c`.
- `node bin/torch.mjs candidate status --json`: no installed version,
  active version, previous version, or stable launcher; generation zero.
- `node bin/torch.mjs candidate plan --source . --json`: correctly rejected
  the checkout with `CANDIDATE_SOURCE_DIRTY`. No candidate was copied.
- Fresh repository/spec intake:
  `/tmp/torch-selfhost-review-20260930-0503.json`, generated
  `2026-09-30T05:04:22.421Z`, working-tree fingerprint
  `86f7bf26fd2be48789fd16bfa2b30bc014b886dfbb5f2842e8f4712a440b12e5`.
  It was generated before this report; subsequent edits invalidate that
  fingerprint for installation. Regenerate after the source checkpoint.
- Deterministic baseline: ten candidate domains, 24 coordination boundaries,
  and four discovered project checks (`test`, `check`, `test-dashboard`,
  `lint`). Baseline review remains pending.

The intake command writes only a temporary brief; it does not call the AI
Session Architect, approve ownership, install a project, or start providers.
Temporary artifacts are convenient review evidence, not durable release
receipts. Preserve final acceptance receipts in the version store when a
specific committed candidate is qualified.

## Roster is not ready for approval

The baseline is a starting point for the Session Architect, not an automatic
instruction to launch ten specialists. Its review focus explicitly identifies
18 unassigned components, including the Console backend, control plane,
backlog, integration, self-host lifecycle, and CLI entrypoints. An empty
`missingOwnership` list means each *selected* domain has paths; it does not
mean every repository component has an implementation owner.

Before approving the real proposal:

1. Assign the omitted components to coherent owners or explicitly retain them
   as owner-managed, out-of-trial surfaces. Do not hide unresolved ownership.
2. Define ownership/protocols for CLI, package metadata, schemas, documentation,
   shared test infrastructure, and cross-domain contracts.
3. Keep repository-wide checks separate from specialist-local checks.
4. Exclude the pre-existing `test-torch-config-host-uQKdqL/` fixture from the
   managed trial and candidate. Do not edit, remove, or adopt it.
5. Review collision protocols rather than accepting every manager-coordination
   suggestion as a resolved implementation boundary.

## Ordered path to the first trial

1. Review the combined local source changes and create a scoped, clean source
   checkpoint. This requires inspecting both modified tracked files and new
   runtime/test files; a blanket add-all risks including the protected fixture.
   Do not reset or discard existing work to obtain cleanliness.
2. Build and validate a commit-bound candidate. Current-source acceptance and
   older artifact-mode receipts do not qualify that new version.
3. Refresh intake against the final checkpoint; validate and review a complete
   project-specific proposal. A paid Architect call requires provider/budget
   approval; deterministic intake does not.
4. Review candidate activation and project installation plans separately.
   Installing the tool must not implicitly launch the fleet or host timers.
5. Install the accepted version and stable launcher, then the approved project
   configuration. Verify `doctor`, roster, worktree and runtime plans while all
   provider sessions remain stopped.
6. Obtain explicit approval for the complete section-32 bounded live trial: the
   owner-facing coordinator, at least two domain managers and the selected
   specialists needed for one real cross-domain task. The proposed Platform and
   Workflow/Experience leads must be reviewed and activated through the hierarchy
   pathway separately; a proposal's assessment alone is not an active graph.
   A one-manager/two-specialist run may be useful rehearsal, but cannot satisfy
   section 32. Keep other sessions dormant
   and persistent timers disabled initially. Select providers/models per
   session and set an invocation or genuinely enforced spending boundary.
7. Run the scenario below; only then qualify scheduler installation and
   interrupted-wake recovery as separate operational trials.

## Live trial acceptance scenario

Record exact task IDs, session IDs, messages, revisions, tested commit SHAs,
integration results, and lifecycle receipts. Require observable evidence for:

- Each specialist receives current on-disk instructions and one assignment.
- Specialists coordinate directly across one real interface boundary.
- At least two domain managers exchange durable coordination on that task's
  integrated outcome, preserving specialist ownership and direct peer communication.
  Record lead identities, graph revision, decision scope and coordination evidence;
  specialist messages or a roster merely listing managers do not prove this gate.
- The manager discovers a waiting approval/blocker and resolves or escalates
  it without overriding an owner-only decision.
- Both branches submit exact tested tips through the serialized integration
  path; nobody independently pushes main. A conflict or failed check returns
  to its author without silently dropping or landing unverified work.
- A stopped/resumed specialist retrieves its existing assigned task before
  another ready task and reloads current instructions.
- Shutdown records current state and leaves no unidentified live provider
  process. Resume preserves identity, task and durable message history.
- Capture total usage and coordination overhead. Cache savings remain an
  unproven hypothesis unless the runtime supplies comparable measurements.
- Verify detach/uninstall plans preserve user code and clearly distinguish
  removing project infrastructure from removing the installed tool version.

Failures are qualification findings, not reasons to weaken checks or silently
restart sessions with unknown process state. COMBATRIG cutover, publishing,
deployment, and larger-fleet scaling remain separate gates.
