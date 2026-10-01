# Test Integrity Notes

## 2026-09-30 — Bounded routine coordination

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-routine-coordination-instructions
      given: A freshly installed Fleet using generated default prompts
      when: Common, manager, specialist, and resume instructions are read
      then: Each preserves own-inbox acknowledgement, direct peer routing, owner exceptions, and paused execution
    - id: SCN-routine-coordination-boundaries
      given: An assigned task and pending peer and owner approvals in a fixed-time local control plane
      when: The named recipient acknowledges messages and the manager attempts a non-owned decision
      then: The task and approvals remain pending until only the named peer decides its approval
    - id: SCN-routine-coordination-paused-dispatch
      given: An assigned task, an approved named-peer request, and a pending owner provider decision
      when: A public runtime start is attempted without an authorized executor
      then: The start is refused, no provider adapter runs, and the assigned task and owner wait remain unresolved
    - id: SCN-routine-coordination-paused-schedule-dispatch
      given: An assigned waiting task, a pending owner provider decision, and an installed manager check-in schedule with wake.enabled false
      when: The public system scheduler dispatches the due owner-authorized coordination schedule
      then: It queues a durable manager review without planning or invoking a provider, while the task and owner wait remain unresolved
  observable_outcomes:
    - Generated tracked instruction text for fresh-install and resume surfaces
    - Durable task state, approval state, named-approver identity, and authority errors
    - Public start refusal, zero adapter invocations, offline identity state, and retained owner wait
    - Installed wake policy, public scheduled-dispatch receipt, zero provider or command invocations, retained assignment and owner wait
  determinism_controls:
    - Disposable local Git repository, SQLite state, and fixed clock
    - No provider calls, network, retries, sleeps, or host timers
  anti_cheat_rationale:
    prevents:
      - Treating acknowledgement as task or approval completion
      - Letting a manager decide an owner or peer approval
      - Omitting policy boundaries from one generated startup surface
      - Re-enabling paused execution or granting starts, spending, publication, destructive recovery, or arbitrary dispatch
      - Treating a queued manager check-in as authorization to start a provider or resolve the underlying wait
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Codex terminal completion correction

```yaml
test_integrity_note:
  change_type: spec_correction
  scenarios:
    - id: SCN-mixed-runtime
      given: A status-zero Codex protocol stream containing thread.started and turn.completed
      when: Fleet startup captures the provider-specific durable identity
      then: The completed turn may record idle with the captured identity
    - id: SCN-codex-terminal-completion
      given: A status-zero Codex stream containing thread.started but no turn.completed
      when: Fleet startup evaluates terminal evidence
      then: Startup fails, retains the captured identity as working, and area startup refuses a duplicate
    - id: SCN-provider-update-cli
      given: The managed-provider fixture simulates a successful status-zero Codex exec stream
      when: Startup follows an approved provider update
      then: The fixture includes turn.completed after thread.started, preserving strict successful-turn evidence
  observable_outcomes:
    - Durable runtime state and captured Codex thread identifier
    - FLEET_START_FAILED outcome and public area-start blocker
  determinism_controls:
    - Disposable local Git fixture and fixed JSON protocol records
    - No provider calls, network, retries, sleeps, or timeout changes
  anti_cheat_rationale:
    prevents:
      - Treating identity creation as successful turn completion
      - Returning idle from a status-zero stream missing terminal evidence
      - Launching a duplicate over an uncertain captured identity
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

Spec basis: a native successful Codex protocol probe emitted ten records ending
in `turn.completed`; `thread.started` establishes identity only, not completion.

## 2026-09-30 — Bounded Codex executor qualification

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-codex-streaming-protocol-reduction
      given: A successful Codex stream containing an initial identity, a multi-megabyte image record, private stderr, and terminal completion
      when: The bounded reducer and lifecycle process the stream
      then: Only identity and terminal records cross the boundary and idle is recorded without private output
    - id: SCN-cli-codex-protocol-routing
      given: A Codex launch planned by the CLI
      when: The CLI invokes the executor
      then: It launches the bounded reducer instead of collecting provider stdout directly
    - id: SCN-codex-final-terminal-state
      given: A stream whose final terminal failure follows an earlier completion, plus real child signal and spawn-error cases
      when: The reducer and lifecycle classify the child outcome
      then: Only the final failed terminal is retained, signals remain uncertain, and a safe spawn-error code is preserved
    - id: SCN-scheduled-manager-wake-terminal-failure
      given: An owner-authorized manager check-in with a planned Codex wake whose stream lacks terminal completion
      when: The actual ScheduleService invokes the wake boundary
      then: The schedule and wake reservation are failed while the manager identity remains working
  observable_outcomes:
    - Bounded reducer stdout, durable runtime state, schedule result, and reservation outcome
  determinism_controls:
    - Disposable Git/control-plane fixtures and fixed protocol records
    - Local SIGTERM-aware child with a readiness marker; no provider, network, retries, or sleeps
  anti_cheat_rationale:
    prevents:
      - Solving image overflow only by shrinking a parent buffer
      - Marking a missing-terminal manager wake as invoked or successful
      - Accepting an earlier completed event after a later failed terminal
      - Retaining private image, token, or reasoning material in durable evidence
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Executor terminal-outcome integrity

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-executor-interrupted-outcomes
      given: A real child that exits cleanly after SIGTERM plus deterministic signal and ENOBUFS executor results
      when: Runtime startup receives a status-zero timeout, signal, or output-overflow error
      then: No idle completion is recorded; captured identity remains working and failure evidence excludes private output
    - id: SCN-scheduled-executor-failure
      given: A scheduled command returns status zero together with ENOBUFS and screenshot-heavy output
      when: The scheduler records its receipt
      then: The receipt is failed, output is bounded, and credential or private-reasoning values are redacted
  observable_outcomes:
    - Durable runtime presence state and retained native session identifier
    - Schedule result, exit status, bounded output, and redacted error evidence
  determinism_controls:
    - Disposable local Git fixtures and a bounded SIGTERM-aware child process
    - Injected signal and ENOBUFS boundaries; no network, provider launch, retry, or sleep
  anti_cheat_rationale:
    prevents:
      - Treating status zero as successful when Node reports timeout or output overflow
      - Marking an interrupted runtime idle and permitting a duplicate launch
      - Passing screenshot payloads, credentials, prompts, or private reasoning into durable receipts
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Early identity and safe no-code diagnostics

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-codex-interrupted-identity
      given: A real local helper whose child emits thread.started then remains alive
      when: The parent observes the reduced bounded identity and sends SIGTERM to the helper
      then: The helper closes by SIGTERM without a terminal success, while lifecycle retains the identity as working and uncertain
    - id: SCN-codex-code-less-diagnostics
      given: Code-less structured model, authentication, or quota errors containing prompt, reasoning, and image adversarial fields
      when: The bounded reducer and adapter classify startup failure
      then: Only the allowlisted category crosses the boundary; no free-form diagnostic or adversarial field remains
    - id: SCN-cli-codex-real-executable
      given: An installed disposable project and an isolated executable named codex
      when: The actual runCli up command starts the selected domain
      then: The reducer carries identity and terminal completion through the CLI boundary and durable identity becomes idle
  observable_outcomes:
    - Real helper close signal, exact reduced protocol bytes, and working retained runtime identity
    - Safe diagnostic category with no prompt, reasoning, image, or free-form message
    - Actual CLI JSON response and persisted identity state from a fake executable on an isolated PATH
  determinism_controls:
    - Local child process signal handshake driven by receipt of thread.started; a bounded watchdog only terminates and awaits the owned fixture on failed emission, never retries or asserts product timing
    - Disposable Git/XDG fixtures and a hermetic executable; a tagged guard rejects an absent or mismatched env before native spawn, then delegates unchanged to native spawnSync only for the validated fake path
  anti_cheat_rationale:
    prevents:
      - Delaying identity output until child close and losing it on interruption
      - Treating code-less model/auth/quota errors as successful or retaining their raw text
      - Testing only an injected launch helper instead of the CLI execution boundary
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Generated exact-check artifacts

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-generated-check-artifacts
      given: A clean managed worktree and an exact check that emits evidence
      when: The same check runs twice through TORCH
      then: Each pass retains separate external bytes and hashes bound to candidate commit, check definition, and run ID while the tested tree stays clean
    - id: SCN-generated-check-mutation
      given: A clean managed worktree and an exact check that emits external evidence
      when: The command exits zero after mutating a tracked source file
      then: The receipt remains incomplete and cannot qualify despite retained output
  observable_outcomes:
    - Recoverable output paths, byte counts, SHA-256 hashes, candidate/check/run provenance, and exact-pass qualification
    - Git worktree status and incomplete receipt for a zero-exit source mutation
  determinism_controls:
    - Disposable local Git fixtures, deterministic run IDs, fixed evidence bytes, and no network or provider calls
    - No retries, sleeps, baseline updates, stashes, restores, or source cleanup
  anti_cheat_rationale:
    prevents:
      - Treating exit zero as an exact-check pass after a tracked expectation changes
      - Losing or overwriting generated evidence between sequential check runs
      - Claiming provenance without retained bytes and a content hash
      - Hiding source mutations through automatic restore or cleanup
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Exact observed-file ownership evidence

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-architect-file-ownership
      given: A committed project with a README, package manifest and JSON schema
      when: The Architect assigns observed files or invents absent files and directory globs
      then: Observed-file claims validate, invented claims fail, and oversized exact evidence reports truncation
  observable_outcomes:
    - Public pending-proposal validity, invented-path and unknown-evidence diagnostics
    - Exact evidence capped at 1000 files with explicit OWNERSHIP_EVIDENCE_TRUNCATED finding
  determinism_controls:
    - Disposable local Git history and fixed generated filenames
    - No provider calls, timers, network, retries or sleeps
  anti_cheat_rationale:
    prevents:
      - Assigning arbitrary unseen paths merely because metadata is not a source component
      - Leaving schemas and manifests permanently unassignable despite observed evidence
      - Claiming whole-repository ownership coverage from a truncated inventory
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Specialist-only project bootstrap

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-bootstrap-specialist-only
      given: Disposable test-only, release-only, combined and empty repositories
      when: Repository analysis generates an initial pending roster
      then: Evidenced QA/release roles have no conflicting catch-all owner and only empty evidence receives Core fallback
  observable_outcomes:
    - Exact generated domain IDs and successful approved-proposal validation
    - Git working tree remains unchanged after analysis and validation
  determinism_controls:
    - Real disposable committed Git histories and local fixtures
    - No provider calls, timers, external network, retries or sleeps
  anti_cheat_rationale:
    prevents:
      - Proposing a default owner that overlaps every subsequently added specialist
      - Suppressing real QA or release roles to avoid ownership rejection
      - Removing the fallback needed for an empty initial project
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

The new scenario first reproduced Core plus QA on a test-only repository.
Production now adds the fallback after evidenced horizontal specialists, not
before them. No previous assertion or collision guard was weakened.

## 2026-09-30 — Bootstrap primary ownership collisions

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-bootstrap-primary-ownership
      given: Two independently evidenced implementation domains in a disposable Git repository
      when: Pending or approved proposals duplicate primary paths or claim a recursive parent of another owner
      then: Validation rejects collisions while shared consultation and disjoint primary ownership remain valid
  observable_outcomes:
    - Pending validator problems and approved-install rejection with PROPOSAL_NOT_APPROVED
    - Recursive planned ownership conflicts rejected even before files exist
    - Backslash-normalized duplicate ownership rejected
    - Repository status remains unchanged
  determinism_controls:
    - Disposable committed Git repository with two source files per domain
    - No provider calls, external network, timers, retries or sleeps
  anti_cheat_rationale:
    prevents:
      - Accepting two implementation owners because their prose claims different outcomes
      - Treating a collision coordination note as authorization for duplicate ownership
      - Rejecting legitimate shared consultative access
      - Checking only existing files and ignoring planned recursive collisions
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

The first new fixture used one file per component; baseline design deliberately
does not create a specialist for every one-file directory. The fixture now has
two real files per domain, matching its stated precondition. No existing tests
or expected ownership behavior changed. The check proves exact and literal
recursive-parent conflicts, not arbitrary glob-language intersection.

## 2026-09-30 — Real Chromium surviving runner interruption

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-browser-descendant-interruption
      given: Real Chromium serves captured inputs through an actual prepared measurement subprocess
      when: Only the disposable TORCH runner dies, then the owned harness is explicitly stopped
      then: Browser initially remains usable, recovery without stopped-executor confirmation is refused, captured process-group terminal events precede abandonment
  observable_outcomes:
    - Real browser DOM, captured commit and visibility after runner exit
    - Pre-opened kernel handles for multiple Chromium group members and the owned harness
    - Terminal group check, no receipts, unchanged resource lease and original build retention
  determinism_controls:
    - Isolated test-owned Linux browser group with PID birth identity validation
    - HTTP readiness and pidfd events, no sleep or retry loops
    - Handles opened before shutdown avoid PID disappearance or reuse races
    - Qualification requires explicit browser and interruption flags
  anti_cheat_rationale:
    prevents:
      - Equating runner termination with browser termination
      - Treating a stopped-runner preview as automatic all-executor proof
      - Waiting on or signalling unrelated browser processes
      - Generating a pass or releasing leases through abandonment
      - Proving only a fake browser or a single process with no descendants
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Dashboard abandoned-check cleanup evidence

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-console-abandoned-check-cleanup
      given: Project-scoped pending, completed and malformed legacy recovery metadata
      when: Read-only snapshot and shared dashboard renderer observe it
      then: Cleanup states remain distinct, abandoned checks remain visible and private evidence is omitted
    - id: SCN-hard-killed-prepared-check
      given: Owned interrupted check with failed then replayed cleanup
      when: CheckService reopens after each outcome
      then: Pending and completed cleanup outcomes are durable and replay preserves one authority audit
  observable_outcomes:
    - Stored recovery metadata and unchanged read-only projection database
    - Escaped dashboard HTML, absent process IDs and private owner evidence
    - Real desktop/mobile Chromium demo with no live API requests or recovery buttons
  determinism_controls:
    - In-memory project-isolation/legacy database scenarios
    - Actual disposable interruption gated explicitly on Linux
    - Browser lifecycle controls and no sleep/retry masking
  anti_cheat_rationale:
    prevents:
      - Hiding abandoned work because it no longer has running state
      - Claiming cleanup complete from missing metadata
      - Leaking private process or input evidence through observations
      - Informational dashboard buttons performing automatic recovery
      - Losing cleanup outcomes after reopening
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Hard-interrupted check recovery and orphan receipts

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-hard-killed-prepared-check
      given: A real measurement subprocess blocked inside a disposable prepared check
      when: Test-owned runner and executor are terminated and the owner explicitly recovers
      then: Snapshot survives interruption, live recovery is rejected, abandonment is audited once and no receipt or lease release occurs
    - id: SCN-frozen-resource-check
      given: A passing frozen receipt whose prepared-operation linkage is interrupted
      when: Exact-pass qualification evaluates it
      then: Orphaned passing output cannot qualify until terminal linkage is restored
  observable_outcomes:
    - Runner and real measurement PID handshake, runner exit and pidfd terminal notification
    - Durable abandoned state, original recovery audit, exact-pass rejection and unchanged lease
    - Owner CLI approval refusal, idempotent replay and owned cleanup preservation
  determinism_controls:
    - Disposable projects with actual subprocesses, no live agents
    - Event-driven handshake and kernel pidfd wait, no timed sleeps or retries
    - Linux interruption qualification explicitly enabled; ordinary skips are not proof
  anti_cheat_rationale:
    prevents:
      - Treating a running database row or stale heartbeat as proof of process death
      - Inventing a pass from interrupted work or orphaned output
      - Deleting an unowned directory during cleanup
      - Automatic resource stealing or executor replay
      - Repeated recovery producing duplicate authority audit events
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

The hard-kill qualification uses Python's Linux pidfd API solely to terminate and
await the exact disposable executor. This is a qualification dependency, not a
TORCH runtime dependency. Normal portable kernel tests do not require it.

## 2026-09-30 — Owner-first scheduled stale-work review

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-manager-stale-work-review
      given: Owner and routine tasks, including blocked work, in a real managed Git fleet
      when: Manager previews or queues a bounded activity review
      then: Owner requests lead, task files remain unchanged, incomplete coverage is unknown and duplicate delivery is suppressed
    - id: SCN-scheduled-stale-work-review
      given: Approved daily local-time cron action with explicit stale-work bounds
      when: Schedule plans the due minute and executes with or without approval
      then: Only approved delivery queues one review, no runtime invokes and task state is preserved
  observable_outcomes:
    - Durable message body and kind, task file bytes and read-only MCP response
    - Actual schedule receipts, exact due-minute behavior and no provider calls
    - Output truncation, scoped task counts and blocked waiting context
  determinism_controls:
    - Disposable installed Git projects with real managed branches
    - Fixed task creation time and explicit local calendar time for cron
    - No host timers, network calls, retries or sleeps
  anti_cheat_rationale:
    prevents:
      - Prioritizing routine tasks above owner requests
      - Treating incomplete commit scans as proven inactivity
      - Automatically reopening blocked tasks or closing old tasks
      - Routine pending check-ins swallowing stale review delivery
      - Invoking AI or shell commands through an informational review
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

The new cadence test initially used a UTC timestamp despite existing host-local
cron semantics, and read the check-in payload outside its existing `checkIn`
receipt envelope. Fixture time/output addressing were corrected; strict minute,
authority, deduplication and task-preservation assertions were retained. No
pre-existing expectations were changed.

## 2026-09-30 — Same-runtime browser conditions and identity continuity

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-real-browser-conditions
      given: One persistent Chromium page with a frame-driven simulation clock
      when: Real subprocess probes surround healthy, frozen, drifting or replacement-runtime measurements
      then: Only healthy work gets an exact pass, preflight-frozen work is never measured and green invalid results remain incomplete
    - id: SCN-check-runtime-continuity
      given: Preflight reports a runtime identity
      when: Postflight loses or changes it, or preflight provides a malformed identity
      then: Green output cannot pass and malformed preflight never measures
  observable_outcomes:
    - Browser-generated runtime identity in probes and measurement output
    - Actual frame-driven clock movement, HTTP measurement counts and exact receipts
    - Retained invalid reasons and snapshot cleanup
    - Historical green flags do not bypass current report continuity validation
  determinism_controls:
    - Disposable projects and loopback-only persistent browser service
    - IPC readiness and frame completion without retries or sleeps
    - Explicit browser qualification opt-in; skipped scenarios are not proof
  anti_cheat_rationale:
    prevents:
      - Probing an independent healthy browser instead of the measured runtime
      - Claiming green command exit proves valid clock conditions
      - Accepting a replacement page with identical build and healthy conditions
      - Executing measurements after invalid preflight
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Real frozen browser and measurement subject identity

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-real-frozen-browser
      given: Captured ignored build queued behind a peer browser lease
      when: Specialist commits newer source and overwrites live output before promotion
      then: Real Chromium sees captured HTML and SHA, newer SHA receives no pass, new-build negative control fails
    - id: SCN-check-measurement-subject
      given: Checks with and without condition policies
      when: Actual child measurement commands inspect their subject environment
      then: Both receive the exact commit and input digest supplied to probes
  observable_outcomes:
    - Browser DOM, retained stdout, exact-SHA receipt lookup and snapshot cleanup
    - Actual child process output rather than a mocked executor
  determinism_controls:
    - Disposable Git repositories and loopback-only browser requests
    - Explicit resource lease release rather than timed waits
    - Browser frame completion awaited without sleeps or retries
    - Browser qualification explicitly enabled and never counted when skipped
  anti_cheat_rationale:
    prevents:
      - Passing by reading the live build instead of captured inputs
      - Unsafe hardlink capture surviving only atomic rebuilds
      - Crediting the newer source SHA with an old build pass
      - Echoing fixed success instead of browser-observed output
      - Supplying identity only to probes but not actual measurements
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Console owner-confirmed pilot conclusions

```yaml
test_integrity_note:
  change_type: [new_tests]
  scenarios:
    - id: SCN-console-hierarchy-conclusion
      given: An activated pilot and same-origin Console access
      when: The owner previews and confirms reversal
      then: Fresh exact plans commit once while missing tokens, altered decisions, other operations, cross-site requests and changed main are rejected
    - id: SCN-console-hierarchy-adoption
      given: A completed pilot with supporting reviewer-reported evidence
      when: The owner separately confirms adoption through the Console API
      then: Adoption succeeds without changing the active graph or starting a runtime
    - id: SCN-hierarchy-pilot-review
      given: A stored completed review but current time precedes pilot maturity
      when: Adoption is planned
      then: The current calendar gate blocks adoption
    - id: SCN-dashboard-demo-browser
      given: The actual Console and an isolated qualitative pilot sample
      when: Adoption is previewed, then reversal is previewed and confirmed
      then: Adoption has no confirmation, reversal shows the scoped plan and changes sample state only
  observable_outcomes:
    - Blocked previews receive no confirmation token
    - Tokens bind target, operation, action and reason before replay handling
    - Existing stale-preview error contracts remain unchanged
    - Current-time maturity is rechecked at conclusion rather than inferred from stored flags
    - Browser demo preserves agents and backlog and contacts no live API
    - Candidate acceptance requires both adoption and reversal API evidence
  determinism_controls:
    - Disposable Git/SQLite fixtures and isolated loopback servers
    - Injected hierarchy calendar clocks with no sleeps
    - In-memory demo transport and Chromium
  anti_cheat_rationale:
    prevents:
      - Recommendations or preview requests changing organization state
      - Cross-operation replay bypassing an exact owner confirmation
      - Future-dated stored evidence bypassing present calendar maturity
      - A different mock dashboard substituting for actual controls
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Read-only pilot comparison dashboard

```yaml
test_integrity_note:
  change_type: [new_tests]
  scenarios:
    - id: SCN-hierarchy-pilot-review
      given: Persisted interim and completed pilot reviews in a disposable project
      when: The Console snapshot reads hierarchy proposals
      then: Latest review comparisons and reviewer-reported provenance appear without changing history
    - id: SCN-dashboard-demo-browser
      given: The actual Console with a sample qualitative inconclusive pilot
      when: Its comparison history opens
      then: Baseline, observed value, units and evidence quality render as separate columns and no recommendation-execution button is offered
  observable_outcomes:
    - Snapshot exposes latest bounded review records with stable identifiers
    - Rendered recommendations explicitly do not change the organization
    - Reviewer-reported evidence is not presented as independently verified
    - Mobile page remains within its viewport and demo makes no live API requests
  determinism_controls:
    - Disposable Git/SQLite fixture and controlled review timestamps
    - In-memory sample transport and loopback Chromium browser
  anti_cheat_rationale:
    prevents:
      - Read-only dashboard observation modifying review records
      - A qualitative observation rendered as measured or independently verified
      - Source-text assertions substituting for rendered comparison behavior
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Owner-confirmed hierarchy conclusions

```yaml
test_integrity_note:
  change_type: [new_tests]
  scenarios:
    - id: SCN-hierarchy-pilot-review
      given: An activated pilot with a complete supporting review
      when: An owner confirms adoption against a fresh plan hash
      then: The pilot is adopted without changing the graph, and unauthorized, unconfirmed or stale confirmations fail
    - id: SCN-hierarchy-pilot-reversal
      given: An activated pilot with actual worktrees, assigned backlog work and durable messages
      when: The owner previews and confirms reversal
      then: Prior relationships return at a new revision without changing implementation ownership, identities, worktrees, tasks, messages or schedules
  observable_outcomes:
    - CLI plan hashes agree with service plans and CLI requires explicit owner confirmation
    - An unrelated new commit invalidates an earlier plan
    - Failed Git commits restore tracked file bytes and the index
    - Injected audit failure rolls back local state but retains the tracked receipt
    - Repeated confirmation reconciles that receipt without committing again
    - Confirmed replays do not duplicate the owner audit
    - Candidate acceptance rejects absent pilot-reversal evidence
  determinism_controls:
    - Disposable Git/worktree and SQLite fixtures
    - Fixed clocks, failing Git hook and injected local audit trigger
    - No real provider or system timer calls
  anti_cheat_rationale:
    prevents:
      - Quietly dropping in-flight work while removing management roles
      - Reusing a stale owner plan after main moves
      - Repeating a committed conclusion after local state recording fails
      - Allowing review recommendations to bypass owner confirmation
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Durable hierarchy pilot comparisons

```yaml
test_integrity_note:
  change_type: [new_tests]
  scenarios:
    - id: SCN-hierarchy-pilot-review
      given: An owner-activated hierarchy pilot with baseline metrics and success/stop criteria
      when: Session Manager records interim and final review evidence
      then: Evidence covers the complete baseline and criteria, matching units and maturity gates are enforced, history is durable and idempotent, and the organization remains unchanged
  observable_outcomes:
    - Inactive pilots and specialist reviewers cannot submit review records
    - Missing or duplicate metrics, mismatched units, premature adoption and unsupported success claims are rejected
    - Qualitative or unavailable observations cannot justify adoption recommendations
    - Review records label evidence reviewer-reported rather than verified
    - CLI lists persisted history and audits are emitted once per unique review
    - Configuration bytes, Git HEAD and piloting state remain unchanged
    - Candidate acceptance rejects missing pilot-review evidence
  determinism_controls:
    - Disposable installed Git repository and SQLite store
    - Controlled activation and review timestamps with no sleeps or providers
  anti_cheat_rationale:
    prevents:
      - Relabeling qualitative evidence as a proven improvement
      - An interim success recommendation automatically adopting management changes
      - Silent omission of unfavorable pilot criteria
      - Passing review storage by mutating the active organization
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Visible unknown manager launches

```yaml
test_integrity_note:
  change_type: [new_tests]
  scenarios:
    - id: SCN-manager-wake-recovery
      given: An interrupted reservation in the project's real SQLite store
      when: The dashboard snapshot observes it before and after owner recovery
      then: Unknown launches are counted and identified, recovery updates the view, and observation does not change reservation records
    - id: SCN-dashboard-demo-browser
      given: The actual Console with a sample unknown manager launch
      when: The owner follows its attention link
      then: The collapsed Operations panel opens and shows the exact launch record without a restart or unlocking control
  observable_outcomes:
    - Presence is displayed separately from unknown launch outcome
    - Runtime termination is never claimed by the read-only projection
    - Attention navigation makes hidden launch details visible
    - Demo still has zero live API requests and no browser errors
  determinism_controls:
    - Disposable Git and SQLite fixture with simulated crash-window state
    - In-memory sample project and isolated loopback browser server
  anti_cheat_rationale:
    prevents:
      - A dashboard read silently unlocking or retrying a launch
      - An attention link pointing into inaccessible collapsed content
      - A passing source-string assertion substituting for rendered UI evidence
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Self-host acceptance requires portable wake and provider evidence

```yaml
test_integrity_note:
  change_type: [new_tests, refactor_tests]
  scenarios:
    - id: SCN-candidate-acceptance-evidence
      given: Green command results but missing portable wake-policy, reservation, recovery or provider-inheritance scenario evidence
      when: Candidate acceptance evaluates the output
      then: Acceptance fails for each omitted marker
  observable_outcomes:
    - Self-host receipts require all new portability and manager safety scenarios
    - Provider inheritance has a unique scenario marker rather than sharing runtime-selection evidence
  determinism_controls:
    - Controlled command results at the candidate validation boundary
  anti_cheat_rationale:
    prevents:
      - Green exit codes standing in for missing requirement evidence
      - Duplicate markers masking an absent provider-inheritance scenario
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Interrupted manager wake inspection and recovery

```yaml
test_integrity_note:
  change_type: [new_tests]
  scenarios:
    - id: SCN-manager-wake-recovery
      given: A persisted reservation representing a crash after a simulated provider launch
      when: A caller inspects or tries to recover the reservation through service and CLI
      then: Only an approving owner with stopped-runtime evidence and an offline manager can recover it, without invoking a provider or bypassing budget and replay guards
  observable_outcomes:
    - Inspection distinguishes blocking unknown launches from completed records without claiming runtime termination proof
    - Missing approval or evidence, non-owner callers, live managers and completed launches are rejected
    - Recovery and its evidence audit commit atomically and repeated confirmation is idempotent
    - The recovered message still cannot be invoked again and its daily budget charge remains
    - CLI inspection and recovery approval boundaries match the service
  determinism_controls:
    - Disposable installed Git repository and SQLite store
    - Fixed UTC clock and simulated provider invocation
    - Crash-window state seeded at the durable reservation boundary
  anti_cheat_rationale:
    prevents:
      - Age-based unlocking or silent invocation retries
      - Recovery that refunds budget or bypasses message replay protection
      - Claiming an offline heartbeat proves runtime termination
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-30 — Explicit portable manager wake policies

This supersedes the earlier unconditional USD-cap requirement. The owner
requires a fleet usable with Codex, Claude, Pi and local/subscription runtimes;
requiring a provider feature absent from every built-in runtime prevented the
requested timer behavior. Enabling count mode is a separate explicit policy
choice. Existing hard-cap scenarios and their strict assertions are unchanged.

```yaml
test_integrity_note:
  change_type: [new_tests, spec_correction]
  scenarios:
    - id: SCN-manager-check-in-count-mode
      given: An owner-enabled count-limited manager schedule and configured Codex, Claude or Pi identity
      when: A tick recovers an existing pending check-in and prepares a wake
      then: Real adapter plans succeed without a fabricated dollar-cap receipt, simulated invocation respects the shared UTC-day budget, and repeat ticks do not duplicate it
    - id: SCN-manager-wake-reservation
      given: One manager invocation is reserved and another schedule targets that manager
      when: The second schedule tries to reserve another wake
      then: The in-flight reservation blocks the second invocation without consuming another budget slot
    - id: SCN-manager-wake-policy
      given: Manager runtime wake configuration
      when: Budget mode or daily limit is absent, or count mode also promises a dollar ceiling
      then: Configuration validation rejects the ambiguous or unbounded policy
  observable_outcomes:
    - Disabled wakes remain disabled and timer installation is separate
    - Codex and Claude default profiles and explicit Pi provider/model can prepare count-limited wakes
    - The output explicitly reports dollarCapEnforced false in count mode
    - A previously unavailable preflight can retry pending delivery without creating a duplicate message
    - Daily limits apply across schedules and reset only across the UTC-day boundary
    - Concurrent manager reservations and duplicate message attempts are refused atomically
    - Legacy positive USD ceilings still select hard-cap mode and unsupported or mismatched receipts fail closed
    - Console timer review displays the shared daily limit and the selected wake policy
  determinism_controls:
    - Fixed clock, disposable Git/worktree/XDG fixtures, real adapter planning and simulated wake callbacks
    - No provider session, host timer, remote Git mutation or dollar expenditure
  anti_cheat_rationale:
    prevents:
      - Claiming invocation counts enforce dollar spending
      - Disabling hard-cap checks to obtain a passing subscription-runtime scenario
      - Counting two schedules as separate daily budgets
      - Stranding unreserved pending messages after an unavailable preflight
      - Launching overlapping manager turns or consuming quota before preflight
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-29 — Product demo and provider portability review corrections

The owner explicitly clarified that the dashboard demo is the actual TORCH
tool with sample data, opened separately, with no browser-tab wording in its
label. This supersedes the earlier miniature four-panel preview assertions.
The replacement checks strengthen the scenario through actual Console browser
interactions. Provider inheritance corrects the Codex-only installation
failure; explicit mixed-runtime assignments remain protected by existing tests.

```yaml
test_integrity_note:
  change_type: [spec_correction, new_tests]
  scenarios:
    - id: SCN-dashboard-demo
      given: A visitor opens the landing page with no connected project
      when: They open the actual dashboard demo and review or confirm sample actions
      then: The shared Console renders and updates only tab-local sample state with zero live API calls
    - id: SCN-install-runtime-selection
      given: Generated roles inherit an installation default and explicit assignments may coexist
      when: The owner selects Codex alone or mixed adapters with an explicit default
      then: Installation respects the selected default and preserves explicit provider assignments
    - id: SCN-cli-install-provider-default
      given: A reviewed generated proposal
      when: The CLI previews Codex-only installation then installs a mixed fleet with Codex as default
      then: The dry-run is read-only and the installed identities and model defaults match the selected adapters
    - id: SCN-domain-runtime-inheritance
      given: A Codex-only Fleet identifies recurring work needing a new domain
      when: The manager proposes a specialist with runtime omitted or inherited
      then: The pending domain uses Codex and proposing does not create or start an identity
  observable_outcomes:
    - Real browser opens a separate page through the cleanly named landing link
    - Ready backlog items appear in Queue, matching the authoritative backlog state model
    - Priorities, requests, artifact feedback, approvals, and profiles update the sample project only after confirmation
    - Replay does not duplicate sample actions; payload drift and unreviewed actions are rejected
    - Reset restores sample records; mobile has no document overflow; browser emits no runtime errors
    - Codex inherits gpt-6-luna/high and Claude inherits sonnet
    - Pending architect designs accept valid Pi/custom adapter names without authorizing installation or invocation
    - Malformed runtime identifiers are rejected and installation retains adapter validation
  determinism_controls:
    - In-memory demo transport, fixed test clock, temporary Git fixtures, loopback browser server
    - Browser test intercepts and fails on every live project API request
    - No provider, timer, remote Git write, or persistent fleet activation
  anti_cheat_rationale:
    prevents:
      - Shipping a separate mock interface that diverges from the actual Console
      - Passing source-only markup checks while real browser controls fail
      - Silently forcing generated roles to Claude or losing explicit mixed assignments
      - Displaying ready work in an unknown-state lane
  relaxation:
    did_relax_any_assertion: true
    if_true_explain_spec_basis: The rejected static four-panel implementation assertions were replaced by stricter shared-Console browser and isolated-state behavior checks based on the owner's explicit correction.
```

## 2026-09-29 — Fail-closed manager wake cost ceilings

```yaml
test_integrity_note:
  change_type: [new_tests, runtime_budget_safety]
  scenarios:
    - id: SCN-runtime-cost-ceiling
      given: A scheduled identity is configured with a maximum USD amount for one wake
      when: TORCH plans the exact create or resume operation for its selected runtime
      then: The adapter must declare that launch mode and return a matching enforced-cap receipt, otherwise no launch action is produced
    - id: SCN-manager-check-in-cost-ceiling
      given: A manager check-in wake has a daily invocation budget and a per-invocation USD ceiling
      when: Its runtime cannot prove support for that ceiling
      then: The check-in remains queued, the wake is skipped, and no daily invocation reservation is consumed
  observable_outcomes:
    - Enabling a schedule wake without a positive max_usd_per_invocation is rejected
    - Runtime adapters declare cap-supported mode identifiers separately for create and resume
    - Built-in Codex, Claude, and Pi modes declare no hard spend-cap modes
    - A trusted fixture adapter receives the exact cap and emits a matching launch-mode receipt
    - A missing, unsupported, or mismatched receipt prevents the manager wake
    - Successful schedule evidence records the enforced mode and configured USD cap
  determinism_controls:
    - Temporary Git project, fixture adapters, fake wake executor, no provider invocation, timer installation, or real billing
  anti_cheat_rationale:
    prevents:
      - Treating a daily launch-count budget as a dollar budget
      - Treating estimated prices or post-hoc telemetry as a hard ceiling
      - Starting persistent/background sessions with only a print-mode budget flag
      - Consuming invocation quota for a wake that cannot meet its required cap
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-29 — Dedicated interactive dashboard demo page

```yaml
test_integrity_note:
  change_type: [new_tests, static_product_demo]
  scenarios:
    - id: SCN-dashboard-demo
      given: A visitor opens the public TORCH landing page without a connected project
      when: The visitor opens the dashboard demo in a new tab and selects Overview, Work board, Agent messages, or Release gates
      then: The matching illustrative sample view is shown without connecting to project state or invoking an action
  observable_outcomes:
    - The landing page contains no dashboard demo workspace; its link targets a dedicated page in a new tab
    - The dedicated demo page is noindex and labels its records as sample data with no live project connection
    - All four tab controls target an existing, labelled panel
    - Tab state and panel visibility are updated together, with keyboard navigation declared
    - The demo uses a page-scoped script with no fetch or XMLHttpRequest path
    - Release gate examples visibly distinguish passed local evidence from open live-provider and owner-review gates
  determinism_controls:
    - Source-level public-site regression with fixed sample markup; no provider, repository API, runtime, or schedule is contacted
  anti_cheat_rationale:
    prevents:
      - Presenting invented dashboard records as live fleet telemetry
      - Coupling a standalone product demo to the landing-page scroll or making it read or mutate a visitor's project
      - Implying local checks equal live provider or release qualification
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Preview-confirmed Console schedule timer setup

```yaml
test_integrity_note:
  change_type: [new_tests, schedule_launcher_control]
  scenarios:
    - id: SCN-console-schedule-launcher
      given: An installed Fleet has persistent system schedules and no TORCH schedule launcher installed
      when: The owner reviews the exact plan and confirms timer installation in the loopback Console
      then: Preview is read-only, stale or cross-origin confirmation is refused, only TORCH-owned unit files are installed, and the operation is audited exactly once
  observable_outcomes:
    - Every configured system schedule including behavior and exact action is included in the preview
    - Unit paths, content digests, project schedule digest, and timer-start effect are visible before confirmation
    - A changed schedule configuration after preview prevents unit creation or systemd calls
    - Confirmation alone performs bounded file writes and the expected systemd enable/start calls
    - Replay returns the same receipt without repeating systemd calls or audit events
    - Snapshot reports installed-file ownership/digest without claiming that systemd currently has the timer active
  determinism_controls:
    - Temporary Git project, temporary XDG data/config directories, loopback HTTP server, fake systemd executor, no provider, timer, or live user-systemd call
  anti_cheat_rationale:
    prevents:
      - Claiming a configured cadence is already installed
      - Applying a stale or cross-origin timer plan
      - Hiding mutating or provider-wake schedule actions from the review
      - Replaying a single-use owner confirmation
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-29 — Owner-confirmed Console runtime profile changes

```yaml
test_integrity_note:
  change_type: [new_tests, dashboard_mutation]
  scenarios:
    - id: SCN-console-runtime-profile
      given: An installed Fleet has an identity assigned to one runtime and the owner wants to change its next-launch provider/model profile
      when: The owner previews and confirms the profile change in the loopback Console
      then: The preview is read-only and exact, stale configuration is refused, the confirmed change is audited, and running sessions are untouched
  observable_outcomes:
    - Cross-origin preview requests are rejected
    - The exact current and proposed runtime/model/reasoning settings are shown before confirmation
    - Switching adapters removes the old adapter-specific identity launch-policy override and validates the selected adapter's effective defaults
    - Configuration digest drift between preview and confirmation requires a fresh review
    - Replaying confirmation returns the same receipt without recording another profile change
    - The resulting owner audit event records the prior and next identity profile; no provider or runtime is started
    - The Console keeps profile review, confirmation, and edit as three distinct explicit controls
  determinism_controls:
    - Temporary installed Git fixture, local Console loopback server, built-in runtime adapters, no AI provider, runtime process, timer, or hosted service
  anti_cheat_rationale:
    prevents:
      - Bypassing the CLI's runtime capability and launch-policy validation from the dashboard
      - Applying a stale or cross-origin provider/model change
      - Implying that profile edits reconfigure an already-running session
      - Silently applying a profile merely because a selector changed
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-29 — Owner-confirmed fast-forward-only forge publication

```yaml
test_integrity_note:
  change_type: [new_tests, forge_publication]
  scenarios:
    - id: SCN-forge-sync
      given: An attached local forge mirrors the project's canonical branch and local canonical main advances
      when: The owner reviews and confirms forge synchronization
      then: Only the exact local canonical commit is published by fast-forward, and remote-ahead or unavailable ancestry blocks without rewriting remote history
  observable_outcomes:
    - Plan is read-only and identifies local and remote commit IDs
    - Missing confirmation cannot update the remote ref
    - Confirmed synchronization publishes the expected commit and records an owner audit event
    - A remote tip not present locally requires an explicit fetch before ancestry can be assessed
    - A remote-ahead tip remains unchanged and sync fails closed after fetch
    - Forge loss degrades synchronization status but local integration remains operational
  determinism_controls:
    - Temporary local bare Git remotes and a side clone; no hosted forge, provider, timer, or persistent user remote
  anti_cheat_rationale:
    prevents:
      - Concurrent direct pushes from overwriting a newer canonical remote ref
      - Treating a plan-time remote observation as a force-push authorization
      - Coupling local integration availability to forge availability
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-29 — FIFO canonical integration drain

```yaml
test_integrity_note:
  change_type: [new_tests, integration_queue]
  scenarios:
    - id: SCN-integration-fifo-drain
      given: Multiple authorized integration requests were verified against the same canonical tip
      when: The landing authority drains the persistent integration queue
      then: Requests are considered in insertion order, each successful landing serializes, and later tips that omit the new canonical commit move to needs_convergence rather than racing or weakening checks
    - id: SCN-cli-integration-drain
      given: An installed project has an empty integration queue
      when: The owner invokes the CLI queue drain with and without explicit confirmation
      then: The unconfirmed operation is refused without changing the canonical commit, while a confirmed one-shot drain returns an empty result and still does not start a background process
  observable_outcomes:
    - Only the configured landing authority can drain or directly land a request
    - One authorized drain invocation is the single FIFO landing process for its ready queue
    - Read-only Console snapshot exposes pending queue insertion order and authorization identity
    - The first current candidate lands through the existing clean-target fast-forward gate
    - A stale later request is visibly deferred and never changes canonical main
    - After its owner converges the latest main and reruns exact-commit checks, a new authorized request can land
  determinism_controls:
    - Temporary Git worktrees, local SQLite state, passing fixture check, no remote, provider, background process, or timer
  anti_cheat_rationale:
    prevents:
      - Concurrent authorized requests from racing the canonical branch
      - Treating a check on an old source SHA as evidence for a converged tip
      - Silently merging a branch that omits a canonical commit landed ahead of it
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Owner approval decisions in the local Console

```yaml
test_integrity_note:
  change_type: [new_tests, dashboard_mutation]
  scenarios:
    - id: SCN-console-owner-approval
      given: Pending structured approvals are assigned either to the project owner or to a manager AI
      when: The owner previews and confirms a decision in the local Console
      then: Only owner-addressed requests can be decided, the exact current revision is rechecked, the requester is notified once, and stale, cross-origin, or replayed actions do not apply
  observable_outcomes:
    - Owner decision preview is mutation-free and presents requester, evidence, revision, note, and effect
    - Confirmation delegates to the existing audited approval transaction
    - A non-owner approver remains the sole decision-maker for its request
    - Concurrent completion invalidates the preview and repeated confirmation is idempotent
  determinism_controls:
    - Temporary Git repository, local SQLite state, loopback HTTP server, no provider, timer, or runtime wake
  anti_cheat_rationale:
    prevents:
      - Owner UI from silently overriding a manager or peer-AI approval target
      - Stale review from deciding a changed request
      - A retry from creating duplicate approval decisions or requester notifications
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Project integration gates in specialist prompts

```yaml
test_integrity_note:
  change_type: [spec_clarification, new_tests]
  scenarios:
    - id: SCN-project-gates-in-domain-prompt
      given: A project has repository-wide checks but no evidence-backed domain-specific check mapping
      when: TORCH generates an implementation specialist prompt
      then: The prompt shows exact project integration check IDs and argv separately without claiming specialist ownership
  observable_outcomes:
    - Every specialist receives repository-wide integration gates configured for the project
    - Domain-specific required_checks remain unchanged unless separately reviewed and evidenced
  determinism_controls:
    - Temporary Git fixture with a package script and no AI provider or runtime command execution
  anti_cheat_rationale:
    prevents:
      - Hiding the gates all domains must pass before integration
      - Inventing test ownership from names or keyword similarity
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Manager check-in cadence floor

```yaml
test_integrity_note:
  change_type: [new_tests, spec_correction]
  scenarios:
    - id: SCN-manager-check-in-cadence-floor
      given: A project configuration has an owner-authorized manager check-in interval
      when: The configured cadence is 59 seconds or exactly 60 seconds
      then: The 59-second cadence is rejected at the project-config boundary and the 60-second cadence remains valid
  observable_outcomes:
    - Invalid high-frequency polling produces a path-specific configuration error before timer reconciliation or runtime wake
    - One-minute manager polling remains configurable and ordinary schedules are unchanged
  determinism_controls:
    - In-memory project-config fixture; no timer, provider, runtime, or wall-clock access
  anti_cheat_rationale:
    prevents:
      - Installing accidentally sub-minute manager polling that can flood durable check-ins
      - Rejecting the 60-second minimum already enforced by the generated-schedule helper
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Candidate untracked-input visibility

```yaml
test_integrity_note:
  change_type: [new_tests, spec_clarification]
  scenarios:
    - id: SCN-candidate-untracked-visibility
      given: A clean committed Git candidate source has one ignored local file and one non-ignored untracked source file
      when: The owner reviews and stages the candidate
      then: The plan lists the untracked source path, the staged artifact excludes it, and ignored local data remains neither listed nor copied
  observable_outcomes:
    - Candidate source identity remains bound to the exact Git commit
    - The review plan exposes every non-ignored untracked path omitted from the candidate
    - Ignored local files and untracked source files do not enter the staged artifact
  determinism_controls:
    - Temporary Git candidate repositories with a committed ignore file and fixed local files; no network, provider, or current checkout mutation
  anti_cheat_rationale:
    prevents:
      - Mistaking the exact committed candidate for a copy of the full working tree
      - Silently hiding excluded, non-ignored source changes from the candidate review
      - Leaking ignored local data into the installed artifact
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Specification responsibility attribution

```yaml
test_integrity_note:
  change_type: [spec_correction, new_tests]
  scenarios:
    - id: SCN-spec-evidence-grounding
      given: A repository has an implementation domain and its external specification has a similarly named prose-only responsibility with no repository path reference
      when: TORCH creates the deterministic baseline and Session Architect brief
      then: The requirement remains an unrepresented review signal and is not appended to the implementation domain based on keyword overlap
  observable_outcomes:
    - Existing repository ownership stays grounded in actual analyzed paths
    - Pathless specification responsibilities remain visible for semantic architect and owner review
    - Specification-only projects may propose provisional groups but must retain missing ownership status
  determinism_controls:
    - Temporary Git fixture, fixed external Markdown specification, local filesystem path checks, no AI provider or project mutation
  anti_cheat_rationale:
    prevents:
      - Converting overlapping terminology into unsupported implementation ownership
      - Hiding specification responsibilities that need human or architect review
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Serialized landing and resume instruction freshness

```yaml
test_integrity_note:
  change_type: [spec_correction, new_tests]
  scenarios:
    - id: SCN-integration-landing-serialization
      given: Two independent control-plane connections target the same project landing queue
      when: One holds the project SQLite write transaction and the other attempts to land an authorized request
      then: The competing lander fails with a retryable busy result without moving the canonical branch, and can land after the lock is released
    - id: SCN-current-instructions-on-resume
      given: A resumed identity has stale prompt copies in its worktree while canonical project prompts have changed
      when: TORCH plans and executes the resume and creates the Fleet brief
      then: The digest-addressed latest canonical bundle includes the current organization role/report context, is delivered, and the brief exposes the same digest
  observable_outcomes:
    - Competing landing cannot perform a stale preflight and mutate the canonical ref during another project writer's transaction
    - Claude and Pi receive current prompt files; Codex receives the current instruction envelope in its resume turn
    - Prompt digest changes when authoritative instructions change and stale worktree files are ignored
    - A changed owner-approved organization graph updates generated role context before resume without changing implementation ownership
  determinism_controls:
    - Temporary Git repositories, independent SQLite handles, fake runtime executors, and changed local prompt fixtures; no provider or network access
  anti_cheat_rationale:
    prevents:
      - Treating sequential readiness checks as sufficient concurrency control
      - Reusing old runtime conversation instructions after policy changes
      - Treating a stale worktree prompt as authoritative
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-29 — Organization-aware lifecycle ordering

```yaml
test_integrity_note:
  change_type: [spec_correction, new_tests]
  scenarios:
    - id: SCN-hierarchy-aware-start-stop
      given: A project has an owner-facing manager, a middle manager, and a specialist reporting through that manager
      when: TORCH plans startup and wind-down and executes them with fake runtimes
      then: Managers start before direct reports, stop after them, and final status is routed to each direct reporting manager
    - id: SCN-hierarchy-startup-cycle
      given: An acyclic role graph binds multiple roles to identities whose collapsed reporting graph contains a cycle
      when: TORCH plans startup or wind-down
      then: Both plans expose an identity-cycle blocker and no runtime executor is called
  observable_outcomes:
    - The returned startup and shutdown order follows the active organization graph rather than roster order or a hard-coded manager exception
    - Each planned identity lists its direct manager identities
    - Wind-down status messages go to direct managers, allowing reports to reach managers level by level
    - Identity cycles block launch and shutdown before runtime mutation
    - Legacy session_manager.start_last configuration is accepted but does not override graph ordering
  determinism_controls:
    - Temporary Git repositories/worktrees, one three-level organization fixture, a role graph whose identity projection cycles, and fake runtime executors
    - No real provider, system timer, or live Fleet process
  anti_cheat_rationale:
    prevents:
      - Passing lifecycle checks using flat roster order while ignoring middle management
      - Routing every specialist wind-down report only to the Session Manager
      - Launching a partially ordered Fleet when persistent identities collapse an acyclic role graph into a cycle
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Organization-aware manager check-in queue

```yaml
test_integrity_note:
  change_type: [new_tests]
  scenarios:
    - id: SCN-manager-check-in
      given: A manager has direct reports with waiting status and unacknowledged blocker messages
      when: TORCH plans and queues a manager check-in
      then: Findings are scoped to the active reporting graph, structured approval waits name the requester and approver, unstructured status is not treated as approval, one durable self-directed request is queued, and a pending request is deduplicated
    - id: SCN-manager-check-in-refresh
      given: A durable manager check-in is pending and new direct-report approval requests arrive after its timestamped snapshot
      when: The bound manager reads the wake and refreshes current check-in state
      then: A read-only identity-bound MCP tool returns the latest reports and named approval waits; specialists cannot use it to inspect manager reports
    - id: SCN-manager-check-in-specialist
      given: A specialist identity has no direct reports
      when: TORCH builds its check-in plan
      then: The plan has no direct reports and creates no spurious attention
    - id: SCN-manager-schedule-coverage
      given: An active organization graph has multiple manager identities with direct reports
      when: TORCH validates the installed schedule configuration
      then: Every manager identity must have its own owner-authorized system check-in cadence or configuration is rejected
    - id: SCN-manager-check-in-schedule
      given: An owner-approved system schedule names a manager check-in coordination action and its manager is offline
      when: The system dispatcher reaches the configured interval
      then: TORCH queues the direct-report request, records run evidence, preserves offline identity state, and makes no provider or shell command call
    - id: SCN-manager-check-in-budgeted-wake
      given: An owner-reviewed manager schedule explicitly enables runtime wake with a daily invocation cap
      when: A check-in is queued for an offline manager and the cap is later exhausted
      then: An injected runtime waker is called at most within the atomic cap; a missing waker blocks dispatch, active managers are not awakened, and durable check-ins remain queued
    - id: SCN-default-manager-checkin-config
      given: A deterministic project fleet proposal is generated
      when: The owner reviews its validated schedules
      then: It includes a 15-minute Session Manager check-in schedule but does not install or start a system timer
    - id: SCN-manager-schedule-growth
      given: A proposed organization graph adds or removes direct reports under managers
      when: TORCH plans schedule coverage for the hierarchy
      then: Missing managers receive a default owner-authorized cadence, existing cadence is preserved, and obsolete schedules are surfaced without removal or activation
  observable_outcomes:
    - Read-only planning reports direct-report status, tasks, blockers, and unacknowledged messages
    - Pending direct-report requests are classified by named manager, peer-AI, or owner approver
    - A queued check-in labels its snapshot as potentially stale and instructs the manager to refresh current durable state before acting
    - The read-only manager refresh is scoped to the bound identity and active direct-report graph; it grants no approval authority
    - Only the named approver can decide; decisions are revision-checked, audited, and durably returned
    - Owner decisions require explicit CLI confirmation and cannot be claimed through a Fleet MCP identity
    - Queuing a request does not launch or steer an AI runtime
    - A schedule tick is authority-gated and duplicate pending requests do not create duplicate inbox entries
    - Runtime wake is disabled by default, runtime/provider calls are represented only by an injected test waker, and one durable atomic daily invocation reservation is shared across manager schedules
    - Deterministic project proposals include a default check-in schedule while timer installation remains a separate owner action
    - Hierarchy planning derives coverage for every manager identity while preserving configured cadence and requiring separate activation
  determinism_controls:
    - Temporary local Git fixtures, fixed project graph, local SQLite state, fake command and wake executors, and no provider runtime or timer installation
  anti_cheat_rationale:
    prevents:
      - Scanning agents outside the manager's direct-report scope
      - Treating free-text waiting summaries as authorization or approval state
      - Allowing a manager to approve a request assigned to another identity
      - Duplicating unacknowledged check-in messages on repeated checks
      - Claiming a provider session was awakened by durable inbox delivery
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Read-only manager and approval flow watch

```yaml
test_integrity_note:
  change_type: [new_tests, dashboard_observability]
  scenarios:
    - id: SCN-console-manager-check-ins
      given: An installed organization has a waiting direct report with a structured approval assigned to the owner
      when: The owner observes the local Console snapshot and opens Flow watch
      then: The snapshot shows the manager, direct-report state, named approver, approval evidence, and cadence while explicitly not claiming timer installation or performing a decision
  observable_outcomes:
    - Read-only SQLite observation returns scoped manager reports and pending approvals without altering Git or project state
    - Owner approvals appear in the attention queue and flow watch; summaries are escaped and private model reasoning is not exposed
    - Timer state is reported as unverified, not inferred from a configured schedule
    - Snapshot endpoint remains GET-only and Flow watch has no approval mutation controls
  determinism_controls:
    - Temporary repository and SQLite fixture, fixed clock, local HTTP server, no provider, systemd query, or runtime launch
  anti_cheat_rationale:
    prevents:
      - Treating a configured schedule as proof its timer is active
      - Inferring approval from vague presence text
      - Letting dashboard observation mutate approval or manager state
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Versioned organization graph foundation

```yaml
test_integrity_note:
  change_type: [new_tests]
  scenarios:
    - id: SCN-organization-graph
      given: A versioned organization graph with an owner, owner-facing role, coordinator, and specialist
      when: TORCH validates the graph, a specialist promotion, invalid ownership, authority leakage, or invalid reporting links
      then: Valid structures are retained and duplicate implementation owners, owner-only authority leakage, cycles, and unknown role references are rejected
  observable_outcomes:
    - Organization graph validator returns the unchanged valid graph or a typed validation error with field evidence
    - The installed project configuration schema accepts the versioned organization graph
    - A specialist identity may hold both specialist and coordination roles without moving implementation ownership
  determinism_controls:
    - In-memory fixed graph fixtures; no clock, random IDs, model calls, or network access
  anti_cheat_rationale:
    prevents:
      - Accepting multiple implementation owners for one surface
      - Granting release or organization approval authority to a coordinator
      - Treating reporting cycles or unknown role links as valid
      - Forcing promotion to transfer implementation ownership
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Adapter-specific launch-policy profiles

```yaml
test_integrity_note:
  change_type: [new_tests]
  scenarios:
    - id: SCN-runtime-launch-policy
      given: Installed identities with runtime-default and identity launch policies for Codex, Claude, and a custom adapter
      when: TORCH resolves launch plans or the owner changes project-local policy
      then: Supported values inherit/override and map to adapter flags, unsupported or unsafe/conflicting values block before execution, legacy Codex defaults migrate without changing their invocation, and edits require --yes without starting sessions
  observable_outcomes:
    - Codex sandbox/approval flags and Claude permission-mode flags match validated policy values
    - Pi and undeclared custom adapters reject policy overrides; fixed Pi safety flags are not weakened
    - Profile inspection exposes effective launch policy and profile mutations only alter future launch plans
  determinism_controls:
    - Temporary local Git repository and deterministic adapter plans; no provider process, network, clock, or live runtime
  anti_cheat_rationale:
    prevents:
      - Silently dropping or substituting unsupported policy values
      - Combining Codex approve-for-me with an explicit sandbox
      - Exposing Claude bypassPermissions as an ordinary profile setting
      - Letting policy edits start sessions or change running identities
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Project-scoped saved backlog views

```yaml
test_integrity_note:
  change_type: [new_tests, interface_redesign]
  scenarios:
    - id: SCN-console-saved-views
      given: An authoritative backlog snapshot and a browser-local project preference store
      when: An owner filters tasks, saves or updates a named view, reloads it, or deletes it
      then: The board shows matching active tasks while task records and server state remain unchanged
    - id: SCN-console-saved-views-storage
      given: Malformed browser preferences or unavailable/quota-limited browser storage
      when: The Console loads or saves a view
      then: Invalid views are ignored, the authoritative unfiltered backlog remains usable, and save failures explain that no task data changed
  observable_outcomes:
    - Saved filters are scoped by stable project identity and contain only bounded names and filter values
    - Owner, state, priority, domain, and text filters combine against current backlog fields
    - Static serving exposes only the fixed work-view asset; the snapshot API remains GET-only
  determinism_controls:
    - Fixed in-memory task objects, injected local-storage doubles, and temporary local repository; no provider, server-side write, or task mutation
  anti_cheat_rationale:
    prevents:
      - Creating another backlog or copying task state into browser preferences
      - Applying one project's filters to another project
      - Hiding storage failures while implying a view was persisted
      - Letting malformed preferences affect the authoritative work board
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Evidence-scoped shared path proposals

```yaml
test_integrity_note:
  change_type: [spec_clarification]
  scenarios:
    - id: SCN-domain-collision
      given: Two domains import a shared source contract while repository-wide package and configuration files are also present
      when: The deterministic domain baseline is generated
      then: Each importing domain lists the actual shared contract, dependency evidence creates coordination, and unrelated repository-wide candidates are not blanket-assigned as shared writable paths
  observable_outcomes:
    - Shared ownership in the baseline is derived from component dependency edges and exact target paths
    - Remaining shared candidates stay visible in architecture review evidence for Session Architect and owner review
  determinism_controls:
    - Fixed source imports and local Git fixture; no provider call or project mutation
  anti_cheat_rationale:
    prevents:
      - Treating all configuration and untracked repository files as writable by every specialist
      - Hiding real cross-domain contract ownership behind an empty shared-path list
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Adaptive owner cockpit observation and scoped feedback

```yaml
test_integrity_note:
  change_type: [new_tests, interface_redesign]
  scenarios:
    - id: SCN-console-readonly
      given: An installed Fleet with durable backlog metadata and local runtime configuration
      when: The owner opens the local Console and its observation endpoint
      then: The responsive dashboard projects task dependencies, identity profiles, conversations, provenance, gates, and attention state without mutating the repository; its snapshot endpoint remains GET-only
  observable_outcomes:
    - Snapshot contains the authoritative backlog fields needed for a kanban projection and runtime/model/reasoning profile fields
    - Missing screenshot/artifact provenance is identified as unavailable rather than represented as an empty verified gallery
    - Console assets render a pulse, work board, attention queue, and accessible responsive navigation
    - POST requests to the observation endpoint are refused
  determinism_controls:
    - Fixed local repository and state fixtures; no provider call, hosted service, or write action through the observation endpoint
  anti_cheat_rationale:
    prevents:
      - Rendering a dashboard board from a second, divergent task source
      - Hiding missing artifact provenance behind a fabricated gallery
      - Treating read-only dashboard rendering as owner authorization
      - Exposing private model reasoning in the communication feed
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Adaptive organization proposals and per-identity runtime profiles

```yaml
test_integrity_note:
  change_type: [new_tests, spec_clarification]
  scenarios:
    - id: SCN-hierarchy-proposal
      given: A versioned active organization and repeated coordination evidence
      when: The Session Manager submits or deduplicates a hierarchy proposal, or an owner reviews it
      then: Sustained evidence and alternatives are required, only the configured owner may decide, implementation ownership remains unchanged, and activation requires a separate fresh plan and owner confirmation
    - id: SCN-hierarchy-reconsideration-after-new-evidence
      given: A hierarchy proposal that was rejected by the owner
      when: The Session Manager submits the same proposed graph with a later evidence window and new references
      then: The new evidence creates a fresh owner-review proposal while exact retries of that evidence remain idempotent
    - id: SCN-hierarchy-pressure-assessment
      given: A project with a configured observation window and durable coordination records
      when: The Session Manager assesses recurring organization pressure
      then: The tool reports only dated in-window evidence, requires recurrence or multiple signals, refuses specialist authority, and never creates or activates a proposal
    - id: SCN-hierarchy-proposal-mcp
      given: An MCP server bound to the Session Manager identity
      when: It proposes, lists, reads, or plans an organization change
      then: The manager can prepare owner-review material but no owner-decision tool is exposed
    - id: SCN-hierarchy-cli
      given: A durable hierarchy proposal created by the Session Manager
      when: A caller attempts owner review through the CLI
      then: A coordination identity is refused, the configured project owner may approve a bounded pilot, and the pilot plan remains non-mutating
    - id: SCN-hierarchy-activation
      given: A fresh, owner-approved hierarchy pilot that promotes an existing identity and leaves the project clean
      when: The owner previews and separately confirms pilot activation
      then: The committed graph and required manager schedules change together while identities, implementation ownership, active tasks, systemd units, and runtime sessions remain untouched
    - id: SCN-hierarchy-activation-rollback
      given: A fresh owner-approved hierarchy pilot and a local Git hook that rejects its activation commit
      when: The owner confirms pilot activation but Git refuses the scoped commit
      then: Canonical config, install manifest, pilot record, and index return to their exact prior state and the proposal remains approved for retry
    - id: SCN-console-hierarchy-activation
      given: An owner-approved hierarchy pilot is shown in the local Console
      when: The owner previews activation, repository state changes, then reviews and confirms a fresh plan
      then: Cross-origin and stale requests are refused, a fresh one-use confirmation creates exactly one scoped activation commit, and no session or timer is started
    - id: SCN-runtime-profiles
      given: Multiple identities assigned distinct registered runtime adapters and model/reasoning profiles
      when: TORCH plans startup, diagnoses identities, and the owner edits installed project-level profile defaults
      then: Each effective profile is routed to its selected adapter, supported config changes affect only a future launch plan, unsupported capabilities block startup with explicit findings, and TORCH does not silently substitute a provider
    - id: SCN-runtime-profile-cli
      given: An installed project with configured runtime defaults and persistent identities
      when: The owner inspects profiles, changes an identity/default, resets identity overrides, or omits explicit confirmation
      then: Writes require --yes, validate the resulting config, preserve identity overrides above runtime defaults, and never start or change a running session
    - id: SCN-pi-adapter
      given: A fleet identity assigned the built-in Pi adapter with a user-selected provider/model profile
      when: TORCH plans a fresh or resumed session
      then: It uses Pi's resumable-turn CLI, scoped prompt and transcript directory, explicit model/thinking selection, and a required model without starting Pi during planning
    - id: SCN-pi-mcp-bridge
      given: A TORCH-bound Pi extension and a local project with an approved roster identity
      when: Pi invokes a registered TORCH tool through the bundled MCP bridge
      then: The extension exposes the complete MCP tool set, binds calls to the configured identity, rejects identity spoofing, and shuts down the per-call MCP process without invoking an AI provider
  observable_outcomes:
    - Hierarchy evidence, decisions, and candidate graph revision persist in the local control-plane database without editing active config or roster
    - A hierarchy pilot plan records graph delta, resulting manager schedules, timer reconciliation requirement, affected active backlog, worktrees, preservation promises, and blockers
    - Explicit pilot activation updates canonical organization and schedule config, install-manifest hashes, and a durable pilot record in one scoped Git commit; no identity, worktree, timer, or provider is started
    - The Console activation preview exposes the exact fresh pilot plan, owner identity, active work, manager cadence delta, blockers, and systemd reconciliation requirement; stale preview cannot activate
    - Replaying a consumed Console activation token returns the same result without creating a second commit
    - When an exact-config timer exists, activation leaves its units unchanged and reports the required separate reconciliation; successful reconciliation applies the new manager cadence, while a failed activation commit leaves the proposal and timer untouched
    - Runtime startup plans report the selected adapter and per-identity profile
    - Identity/agent queries and dashboard snapshots expose the effective runtime defaults plus any per-identity overrides
    - Editing installed runtime defaults updates future launch plans and dashboard snapshots without starting or stopping a session
    - Pi launch plans retain the same Pi session identifier and isolate transcript data under local TORCH project state
    - Pi extension tools match the MCP server manifest and cannot claim another roster identity
  determinism_controls:
    - Fixed project fixtures, explicit timestamps and identities, registered test adapters, no provider calls, and temporary local Git repositories
  anti_cheat_rationale:
    prevents:
      - Promoting a role from a single uncorroborated observation
      - Treating a manager proposal as owner approval or as live organization state
      - Transferring implementation ownership through coordination hierarchy changes
      - Claiming a runtime supports model or reasoning controls it does not implement
      - Silently replacing an unavailable or unsupported runtime profile
      - Loading arbitrary project Pi extensions into TORCH Pi sessions
      - Allowing a Pi model to escape its identity-bound TORCH MCP context
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Provenance-backed visual evidence and routed owner feedback

```yaml
test_integrity_note:
  change_type: [new_tests, interface_redesign]
  scenarios:
    - id: SCN-artifact-review
      given: An installed Fleet, one assigned task, a publishing identity, a full Git commit, and a bounded image in that identity worktree
      when: The identity publishes the image, then the owner previews and confirms feedback through the CLI or the local Console
      then: TORCH preserves task, identity, runtime-session, commit, and digest provenance; routes the comment as a durable message to the task owner; and serves only digest-verified bytes
    - id: SCN-artifact-boundaries
      given: Artifact publication or feedback input with an unknown task, abbreviated commit, symlink, path traversal, wrong actor, or tampered content
      when: TORCH validates or serves the item
      then: The operation fails with a typed error and does not claim the image is verified
  observable_outcomes:
    - Images are copied into private project-local external state, never checked into the project repository by the artifact service
    - Feedback preview is mutation-free; only the configured owner can create the durable message, linked to artifact, task, and exact commit
    - The observation endpoint remains GET-only; Console feedback requires same-origin loopback JSON and a single-use five-minute preview token bound to the exact message effect
    - Stale, expired, cross-origin, and replayed confirmations are refused without adding a message
    - The Console displays comments without exposing private model reasoning or changing backlog state
    - Content tampering is rejected by the serving route and marked unavailable in the snapshot
  determinism_controls:
    - Temporary local Git repository, one-pixel fixed PNG, deterministic runtime identity, local SQLite, and loopback fixture HTTP; no provider or hosted network calls
  anti_cheat_rationale:
    prevents:
      - Attaching an image to a task not owned by its publishing identity
      - Accepting an abbreviated or missing commit as exact provenance
      - Traversing symlinks or copying external files into the gallery
      - Treating a feedback preview as an owner decision
      - Letting a cross-origin caller forge owner feedback or replay a prior confirmation
      - Serving tampered image bytes as trusted visual evidence
      - Adding a second comment ledger beside durable inter-session messages
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — User-trusted local runtime adapters

```yaml
test_integrity_note:
  change_type: [new_tests, security_boundary]
  scenarios:
    - id: SCN-runtime-plugin-trust
      given: A local CommonJS adapter module that is not in TORCH's user-local trust store
      when: The owner previews trust, edits the module after preview, approves the stale digest, lists adapters, loads the reviewed plugin, and later revokes trust
      then: Preview/list never execute the module; approval requires the exact reviewed SHA-256; changed code fails closed; the adapter runs only after trust; revocation does not claim to stop running sessions
    - id: SCN-runtime-plugin-lifecycle
      given: An installed Fleet whose project configuration initially uses only a built-in adapter and a separately user-trusted local plugin
      when: The owner assigns that plugin to one identity and TORCH plans the mixed Fleet
      then: Project-local profile configuration may select the already-trusted adapter, the launch plan uses its declared model/reasoning/capabilities, and the plan starts no runtime
  observable_outcomes:
    - Trust records are user-local, outside project-controlled configuration, and pin the canonical entrypoint SHA-256
    - Trust and revocation require --yes plus the exact hash shown by the review plan
    - Project configuration cannot register a module path or authorize plugin code
    - Runtime plugin load failures are surfaced in the registry/doctor; no provider substitution occurs
    - Profile selection may add a locally trusted adapter's declared configuration to the project without starting or stopping sessions
  determinism_controls:
    - Synthetic local adapter with a load sentinel, temporary XDG config/data roots, and temporary Git repository; no network or AI provider calls
  anti_cheat_rationale:
    prevents:
      - Executing a plugin during trust preview or runtime catalog listing
      - Reusing owner approval after the entrypoint changes
      - Letting project-edited JSON invent a trusted adapter or executable path
      - Treating an adapter launch plan as evidence that a provider was started
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Backlog-derived feature and milestone progress

```yaml
test_integrity_note:
  change_type: [new_tests, dashboard]
  scenarios:
    - id: SCN-backlog-classification
      given: A backlog task with an explicit revision and a Session Manager identity
      when: The manager classifies or clears its feature and milestone labels through the service, CLI, or MCP tool
      then: TORCH revision-checks and audits only the labels; task ownership, state, evidence, dependencies, and queue order remain unchanged
    - id: SCN-console-initiative-rollups
      given: Backlog tasks with explicit feature and milestone labels, including completed, cancelled, blocked, active, and unlinked tasks
      when: The Console derives progress summaries
      then: It groups only explicitly labeled tasks, excludes cancelled tasks from the completion denominator, reports risk and task-state counts, and does not alter source records
  observable_outcomes:
    - Feature and milestone labels remain optional fields on the authoritative backlog task, not a parallel initiative ledger
    - Classification is manager-only, reasoned, revision-checked, and retained in task-local history plus the audit stream
    - Unlabeled tasks remain ungrouped; names and completion are never inferred from paths, domains, or prose
    - Progress percentages describe task states only and cannot imply passing tests, integration, release, deployment, or live verification
  determinism_controls:
    - Fixed task fixtures and browser helper execution; no provider calls, network calls, or live project mutation
  anti_cheat_rationale:
    prevents:
      - Treating dashboard percentages as release or quality qualification
      - Introducing a competing feature/milestone queue
      - Letting specialists or stale revisions change project classification
      - Silently fabricating labels for unclassified work
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Preview-confirmed owner backlog reprioritization

```yaml
test_integrity_note:
  change_type: [new_tests, security_boundary, dashboard]
  scenarios:
    - id: SCN-owner-backlog-priority
      given: A backlog task with a current revision and a local project owner
      when: The owner previews and confirms a reasoned priority change, or a specialist attempts the same operation
      then: Only owner authority can apply a revision-checked change; task state, owner, dependencies, and evidence stay unchanged; history and audit record the change
    - id: SCN-console-priority-confirmation
      given: An installed Fleet task and the loopback Console
      when: The owner previews a priority change, the task changes concurrently, a request comes cross-origin, or a token is replayed
      then: Only a fresh same-origin preview confirmation applies the exact reviewed effect; stale, cross-origin, expired, and replayed requests fail without an additional mutation
  observable_outcomes:
    - Preview is mutation-free and identifies task, revision, previous/new priority, reason, and bounded effect
    - Confirmation consumes a five-minute single-use token and recomputes the revision-bound plan before writing
    - Owner priority changes have durable task history and a control-plane audit event
    - Snapshot remains GET-only and the Console gains no task-state, assignment, evidence, integration, release, or lifecycle write route
  determinism_controls:
    - Temporary installed Git fixture, local SQLite state, and loopback HTTP requests; no provider or hosted network calls
  anti_cheat_rationale:
    prevents:
      - Applying a priority selected after preview without renewed confirmation
      - Reusing a stale revision or confirmation token
      - Crossing origin boundaries to invoke owner actions
      - Treating reprioritization as authority to reassign work or claim task completion
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Dark TORCH product surface and v1 mark

```yaml
test_integrity_note:
  change_type: [interface_redesign, asset_reuse]
  scenarios:
    - id: SCN-torch-brand-surface
      given: The public TORCH site and loopback Fleet Console
      when: Both surfaces load their shared design tokens and brand assets
      then: Dark color-scheme is the default, accessible text/status contrast remains intentional, and the actual v1 torch mark is used as the wordmark icon and browser favicon
  observable_outcomes:
    - The source v1 SVG is confirmed from the legacy/nostr-torch branch and served through a fixed local asset route
    - Both public and Console HTML reference the same torch mark and declare a dark browser theme color
    - Responsive layout, focus indicators, and reduced-motion behavior remain in the shared stylesheet
  determinism_controls:
    - Static markup/style assertions and loopback fixed-asset route test; no browser extension or network resource required
  anti_cheat_rationale:
    prevents:
      - Replacing the historical logo with a lookalike glyph
      - Applying dark mode only to the Console while leaving the public product page inconsistent
      - Referencing an external or unpinned logo asset
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Preview-confirmed owner task proposals

```yaml
test_integrity_note:
  change_type: [new_tests, authority_boundary, dashboard]
  scenarios:
    - id: SCN-owner-backlog-create
      given: An installed Fleet with a configured owner and Session Manager
      when: The owner plans and creates a new task proposal, or a specialist attempts either operation
      then: Only owner authority can propose the task; it is audited, proposed, unassigned, and leaves dispatch authority with the Session Manager
    - id: SCN-console-task-create-confirmation
      given: An installed Fleet and the local loopback Console
      when: A task proposal is previewed, altered, confirmed, replayed, or submitted cross-origin
      then: Only a fresh same-origin confirmation creates the exact reviewed proposal; changed inputs and cross-origin calls do not mutate the backlog, and an exact retry returns the same task without creating another
  observable_outcomes:
    - Preview records exact normalized task fields, observed commit, routing suggestions, dependencies, and the proposed/unassigned effect without writing a task
    - Confirmation uses a five-minute token bound to the reviewed plan; each token creates at most one task
    - Domain selection records affected domains only; it does not bind implementation ownership or dispatch work
    - Owner action is durably audited and does not alter runtime/session state
    - Existing Session Manager task creation and assignment authority remain unchanged
  determinism_controls:
    - Temporary installed Git fixture, local SQLite state, and same-origin loopback HTTP requests; no provider turn or live project write
  anti_cheat_rationale:
    prevents:
      - Treating routing suggestions as specialist assignment
      - Creating work on stale or changed preview content
      - Replaying a browser retry into duplicate task records
      - Escalating the owner interface into task-state or runtime lifecycle authority
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Owner review of Fleet and hierarchy proposals

```yaml
test_integrity_note:
  change_type: [owner_authority, dashboard, state_transition]
  scenarios:
    - id: SCN-console-organization-review
      given: An installed TORCH Fleet with proposed Fleet and hierarchy changes
      when: The owner previews, tampers with, confirms, or replays a proposal decision
      then: Only a fresh same-origin preview can record the reviewed owner decision, and no decision directly activates organization state or starts an agent
  observable_outcomes:
    - Preview is mutation-free and displays the current proposal, scope, evidence, effect, owner identity, and repository head
    - Hierarchy preview shows manager check-in schedule additions/obsolete candidates and reports timer installation as unverified; any config-bound timer reconciliation remains a separate step
    - Schedule-launcher reconciliation refreshes the digest-bearing service for newly added manager schedules, refuses changed or missing owned units, updates the manifest only after validation, and restores exact prior unit and manifest state if systemd reload fails
    - Confirmation rechecks the proposal state, active graph, current head, and exact plan hash; stale and cross-origin requests are refused
    - Fleet approval only authorizes a later activation review; hierarchy approve-pilot does not itself activate, and a separate activation rejects stale, dirty, unapproved, or non-owner plans
    - A successful owner decision is audited by the existing proposal services and exact retries do not create duplicate effects
    - Organization review controls use the existing proposal ledgers; they do not write the active graph, provision worktrees, or launch providers
  determinism_controls:
    - Temporary installed Git fixture, local SQLite state, and loopback HTTP requests; no provider or hosted network calls
  anti_cheat_rationale:
    prevents:
      - Treating a staged approval as activation, runtime launch, or hierarchy adoption
      - Applying a decision after the proposal, active graph, or current repository head changed
      - Replaying or forging a consequential owner action from another origin
      - Creating a second dashboard-only organization proposal ledger
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Installed Pi extension startup without a model turn

```yaml
test_integrity_note:
  change_type: [new_tests, runtime_adapter, provider_boundary]
  scenarios:
    - id: SCN-pi-installed-extension-startup
      given: An installed Pi CLI and TORCH's bundled identity-bound extension
      when: Pi starts in offline, no-session RPC mode with no prompt and requests only its state
      then: The extension loads, its TORCH-specific flags are accepted, RPC responds, and no extension error or provider turn occurs
  observable_outcomes:
    - Pi's extension API resolves its declared TypeBox runtime dependency from TORCH's installed package
    - Local adapter qualification checks the actual installed Pi loader rather than only a mocked registration API
    - Missing Pi is reported as a skipped host-specific smoke test; a present but incompatible Pi fails the scenario
  determinism_controls:
    - PI_OFFLINE=1, PI_TELEMETRY=0, isolated temporary Pi config/session paths, --no-session, and no prompt
  anti_cheat_rationale:
    prevents:
      - Treating mocked extension registration as proof that Pi can load the distributed extension
      - Calling a model or depending on provider credentials to qualify local extension loading
      - Allowing project extension discovery or project trust during the smoke test
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Preview-confirmed owner agent requests

```yaml
test_integrity_note:
  change_type: [owner_authority, durable_messaging, dashboard]
  scenarios:
    - id: SCN-console-owner-agent-request
      given: An installed Fleet, an approved roster identity, and an optional active backlog task
      when: The owner previews, changes, confirms, replays, or submits a request cross-origin
      then: Only a fresh exact preview can write one audited durable message to the selected inbox; backlog, ownership, identity state, and runtime lifecycle remain unchanged
  observable_outcomes:
    - Preview identifies exact recipient, title, message body, optional task reference, active graph, repository head, and no-start/no-reassignment effect
    - Confirmation recomputes that plan; altered input, changed repository, unknown task, cross-origin, expired, and replayed requests fail closed
    - Owner identity is checked against the active organization graph and the durable owner message is visible through existing conversation reads
    - Idempotent retry returns the original message without adding a second inbox item or audit action
  determinism_controls:
    - Temporary installed Git fixture, local SQLite state, and same-origin loopback HTTP requests; no provider or runtime launch
  anti_cheat_rationale:
    prevents:
      - Turning an owner request into a new task queue or silent assignment
      - Starting or waking an agent as a side effect of sending a message
      - Reusing a preview after its request text or repository evidence changed
      - Allowing non-owner identities or cross-origin pages to create owner requests
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — COMBATRIG backlog migration assessment

```yaml
test_integrity_note:
  change_type: [new_tests, importer_compatibility]
  scenarios:
    - id: SCN-combatrig-backlog-assessment
      given: A legacy fleet repository has roster-backed areas, a manager-area queue, an unknown historical area, free-form assignee names, and legacy terminal statuses
      when: Torch builds a read-only compatibility proposal
      then: It reports counts and unmapped references, does not infer identity ownership, does not create backlog tasks, and distinguishes legacy done from verified Torch completion
  observable_outcomes:
    - Backlog inventory reports counts by source area and status plus unmapped source areas
    - The ai-sessions alias is visible as Session Manager queue history requiring review, not specialist implementation ownership
    - Free-form assignedTo values are not treated as runtime identity IDs
    - Legacy done is not marked as completed without target commit, evidence, and landed integration provenance
    - Repository Git status is unchanged by compatibility analysis
  determinism_controls:
    - Temporary Git fixture with four fixed backlog items; no actual COMBATRIG writes, task creation, provider, or runtime
  anti_cheat_rationale:
    prevents:
      - Silently discarding queue items from retired or unmapped areas
      - Converting display names to executable runtime identities
      - Bypassing Torch's verified-completion evidence gate
      - Claiming migration when only a status count was inventoried
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Candidate failure diagnostics

```yaml
test_integrity_note:
  change_type: [new_tests, candidate_acceptance]
  scenarios:
    - id: SCN-candidate-failure-diagnostics
      given: Candidate acceptance checks return both stdout and stderr and one check fails
      when: TORCH reports the candidate acceptance result
      then: The failed check includes bounded output excerpts while successful checks do not duplicate their logs
  observable_outcomes:
    - Test failures and subprocess errors include actionable captured output in candidate build diagnostics
    - Excerpts are bounded to 12,000 characters per stream and retain the final output where the likely failure cause appears
    - Successful validation receipts preserve check status and output byte counts without embedding full logs
  determinism_controls:
    - Injected child-process results; no filesystem, provider, runtime, or network use
  anti_cheat_rationale:
    prevents:
      - Reporting a failed candidate without the reason needed to fix it
      - Dumping unbounded process output into CLI errors and validation receipts
      - Duplicating successful test logs into persistent metadata
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-28 — Candidate acceptance evidence completeness

```yaml
test_integrity_note:
  change_type: [new_tests, reliability_fix]
  scenarios:
    - id: SCN-candidate-acceptance-evidence
      given: The self-host candidate manifest lists required acceptance scenarios
      when: TORCH maps test output markers into the candidate validation receipt
      then: Every required scenario has one or more explicit markers, and missing evidence prevents candidate acceptance
  observable_outcomes:
    - The evidence mapping keys exactly match the required acceptance scenario list
    - Hierarchy activation, manager check-in schedules, and approval routing must be present in test output before their scenarios are accepted
    - An unmapped or marker-free required scenario can never pass through an empty evidence condition
  determinism_controls:
    - Synthetic check output with all mapped markers, followed by a run missing one hierarchy activation marker
    - No repository mutation, runtime, timer, or provider access
  anti_cheat_rationale:
    prevents:
      - Treating test and lint exit codes as proof that every declared product scenario was exercised
      - Quietly accepting newly added required scenarios without corresponding test evidence
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-29 — Candidate acceptance state isolation

```yaml
test_integrity_note:
  change_type: [reliability_fix, new_tests, spec_completion]
  scenarios:
    - id: SCN-candidate-acceptance-isolation
      given: Candidate validation is launched while the installer has a configured XDG data home
      when: TORCH runs candidate test, lint, and syntax gates
      then: Every child uses a disposable temporary HOME, TMPDIR, and XDG roots distinct from the candidate version store, and those roots are removed after validation
  observable_outcomes:
    - The inherited installation XDG data root is not passed to acceptance children
    - All three gates share only the isolated temporary user-state roots
    - Acceptance cleanup removes the temporary roots after success or failure
    - Candidate activation and the active version pointer remain untouched
  determinism_controls:
    - Injected child-process runner captures exact cwd and environment without running a provider or timer
    - Candidate version storage and acceptance HOME use distinct temporary roots
  anti_cheat_rationale:
    prevents:
      - Tests mutating or colliding with the candidate installer state they are meant to qualify
      - Passing source-tree checks while the copied candidate fails under inherited user XDG configuration
      - Candidate validation leaving user-state artifacts behind
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-29 — Owner-authorized scheduled integration drain

```yaml
test_integrity_note:
  change_type: [spec_correction, new_tests]
  scenarios:
    - id: SCN-scheduled-integration-drain
      given: A project has a reviewed periodic integration-drain schedule and a source commit with passing exact-SHA checks
      when: The system schedule dispatches first before and then after per-request landing authorization
      then: The unauthorized request stays unlanded, the authorized request lands through the FIFO integration service, and no timer is installed merely by defining the schedule
  observable_outcomes:
    - Integration drain is accepted only as a periodic, owner-authorized system mutation using configured landing authority
    - Sub-minute intervals and retries are rejected before scheduled execution
    - A request without per-item landing authorization is not drained even when the schedule itself is owner-approved
    - A request with fresh exact-commit check receipts lands through the same serialized integration path
    - Schedule configuration alone does not install or start the user-systemd timer
  determinism_controls:
    - Disposable local Git repository/worktree, fixture check receipt, manual clock, no remote, provider, real systemd executor, or runtime
  anti_cheat_rationale:
    prevents:
      - Turning a background schedule into blanket approval for queued code
      - Draining work without exact-SHA evidence or configured landing authority
      - Implying that review or configuration automatically activates persistent host state
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-29 — Evidence-backed organization assessment in Session Architect proposals

```yaml
test_integrity_note:
  change_type: [new_tests, spec_completion]
  scenarios:
    - id: SCN-architect-organization-assessment
      given: A project has two evidenced implementation domains and a Session Architect proposal is pending
      when: The proposal recommends either a flat fleet or a coordination lead
      then: The choice is evidence-validated, proposed leads state an integrated outcome and bounded decisions, implementation and owner authority remain separate, and direct peer communication stays available
  observable_outcomes:
    - The bootstrap brief presents hierarchy evidence, all six authority distinctions, and a flat-by-default recommendation without selecting a fixed role catalog
    - A coordination role must cite known evidence, coordinate only existing domains, and name an integrated outcome, decision scope, and owner escalations
    - Duplicate or unknown domain references and fields outside the authority contract are rejected
    - A role that claims implementation paths or owner-approval authority is rejected
    - An unresolved shape, fabricated evidence, or manager-only peer routing is rejected
    - The proposal remains pending and no identity, organization graph, runtime, or provider is activated
  determinism_controls:
    - Temporary Git project with two local source domains and a synthetic provider response; no paid provider, runtime, or installation
  anti_cheat_rationale:
    prevents:
      - Copying a fixed management hierarchy into unrelated projects
      - Promoting relays without evidence or an integrated outcome
      - Smuggling code ownership or owner authority into coordination roles
      - Turning hierarchy into a communication bottleneck
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

## 2026-09-29 — Read-only organization lifecycle order in the owner Console

```yaml
test_integrity_note:
  change_type: [new_tests, interface_redesign]
  scenarios:
    - id: SCN-console-readonly
      given: An installed Fleet with an approved reporting graph and managed identities
      when: The owner views the organization section in the local Console
      then: Startup and wind-down orders match the runtime planner, direct manager dependencies and hierarchy blockers remain visible, and observation performs no lifecycle action
    - id: SCN-console-lifecycle-blockers
      given: An installed Fleet whose valid role graph collapses into an identity-level reporting cycle
      when: The owner opens a fresh Console snapshot
      then: The lifecycle projection exposes the cycle blocker and performs no start or stop action
  observable_outcomes:
    - Startup lists managers before their reports using the same ordering function as fleet startup
    - Wind-down lists the exact reverse order used by fleet shutdown
    - The projected order includes direct manager identities and any graph blockers
    - An identity-level reporting cycle remains an explicit lifecycle blocker in the fresh snapshot
    - The lifecycle projection states mutationPerformed false and offers no start/stop controls
    - Narrow layouts stack the two ordered sequences without hiding identities
  determinism_controls:
    - Temporary installed Git project, deterministic organization graph, no runtime adapter invocation, timer, provider, or host service
  anti_cheat_rationale:
    prevents:
      - A dashboard-only order that disagrees with executable lifecycle policy
      - Hiding a missing manager or identity cycle behind a plausible sequence
      - Representing an observation preview as a session launch or shutdown
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```
# Frozen queued-check input scenarios (2026-09-30)

```yaml
test_integrity_note:
  change_type: [new_tests, refactor_tests]
  scenarios:
    - id: SCN-frozen-check-inputs
      given: Approved build inputs and matching project commit marker
      when: Source is rebuilt in place after capture
      then: Frozen bytes stay unchanged and only the owned copy can be removed
    - id: SCN-frozen-check-rejection
      given: Stale markers, unsafe input paths or modified copies
      when: Capture or verification is requested
      then: No qualifying snapshot is accepted
    - id: SCN-frozen-resource-check
      given: A browser slot is occupied and a specialist prepares its inputs
      when: The specialist commits and rebuilds before its slot becomes free
      then: CLI and identity-bound MCP run the captured build and receipt its original SHA
    - id: SCN-frozen-check-mutating-executor
      given: An executor changes input bytes or fails to launch
      when: The prepared check finishes
      then: Nonpassing evidence is persisted and the owned copy is cleaned up
  observable_outcomes:
    - Actual filesystem bytes, independent inodes, exact-SHA receipts and persisted prepared states
    - CLI approval refusal and identity-bound MCP results
    - Candidate acceptance rejects missing frozen-input evidence even with green command exits
  determinism_controls:
    - Disposable Git repositories and source/build fixtures
    - Explicit FIFO acquisition and release without waits or retries
  anti_cheat_rationale:
    prevents:
      - Reusing a live build directory under a frozen label
      - Unsafe hardlinks to mutable outputs
      - Crediting an old test to a newer specialist commit
      - Green executor exit hiding changed inputs
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```
# Project-defined test-condition receipts (2026-09-30)

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-check-conditions-contract
      given: A real project probe reports matching subject and required conditions
      when: Measurements execute
      then: Pre/post reports validate and the diagnostic precedes measurement output
    - id: SCN-check-conditions-fail-closed
      given: False, missing, malformed or wrong-subject reports
      when: A check is requested
      then: Measurements do not execute
    - id: SCN-check-condition-drift
      given: Initially valid conditions
      when: A green measurement changes visibility
      then: The invalid postflight makes the evidence incomplete
    - id: SCN-condition-receipts
      given: Live and frozen checks with condition policy
      when: Check results are persisted and queried
      then: Valid reports persist and missing evidence or changed policy cannot qualify
  observable_outcomes:
    - Real subprocess output and absence or presence of measurement files
    - Durable exact-commit receipt fields, condition artifacts and pass qualification
    - Candidate acceptance rejects omitted condition scenario markers
  determinism_controls:
    - Fixed clock and disposable local Git/filesystem fixtures
    - Probe reports use independent copies of expected subject values
    - Policy-change checks edit canonical project configuration, not an in-memory service map
  anti_cheat_rationale:
    prevents:
      - Treating exit zero as proof of correct test conditions
      - Running measurements despite invalid preflight
      - Passing results despite postflight drift
      - Applying a report to a different build or condition policy
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```
# Policy-controlled specialist self-claim (2026-09-30)

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-console-live-refresh
      given: Concurrent snapshot reads, edited model/task fields and an active approval preview
      when: Controlled 15-second refreshes and explicit owner actions run
      then: Reads remain single-flight, stale responses are discarded, unrelated evidence updates, draft/preview DOM survives, completing one action preserves other drafts and failures retain evidence
  observable_outcomes:
    - Deferred promise request ordering without sleeps
    - Real browser input values, original preview token and unprotected panel node replacement
    - Successive external profile changes update a clean editor without falsely marking it dirty
    - Pause/resume, hidden visibility and page lifecycle timer behavior
    - Missing scenario marker blocks candidate acceptance
  determinism_controls:
    - Explicit promise resolution for read races
    - Playwright clock with controlled visibility/page lifecycle events
    - Isolated demo transport and zero live API calls
  anti_cheat_rationale:
    prevents:
      - Re-rendering over owner drafts or issuing a different preview token
      - Allowing slow background reads to starve updates
      - Completing an action by clearing unrelated forms
      - Using real sleeps or broad retry loops to hide races
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-console-operation-outcomes
      given: Unknown delivery effects, interrupted operations, malformed receipts and credential-bearing arbitrary metadata
      when: Read-only project-scoped evidence is rendered through the shared dashboard
      then: Unknown and unconfirmed states stay explicit, success does not imply live deployment, arbitrary metadata is omitted, safe text is escaped and no retry buttons or state mutations appear
  observable_outcomes:
    - In-memory SQLite records unchanged after observation
    - Cross-project records excluded and raw secret references/error codes omitted
    - Real isolated browser demo renders outcome/effect uncertainty on desktop and mobile
    - Missing scenario marker blocks candidate acceptance
  determinism_controls:
    - Explicit SQLite fixtures and isolated demo transport
    - Live API calls aborted during browser tests
  anti_cheat_rationale:
    prevents:
      - Interpreting command success as a live release claim
      - Leaking raw adapter references or arbitrary error text
      - Retrying uncertain effects from a read-only dashboard
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

Browser review exposed a genuine mobile section-heading overflow. Production
CSS now allows the title/status row to wrap; the strict document-width assertion
remains unchanged. No retry, sleep, hidden overflow or tolerance was added.

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-canonical-fetch
      given: An installed project with a local canonical remote containing a new commit
      when: Owner-confirmed object import encounters one transient failure then succeeds
      then: Attempts are durable and bounded, exact objects arrive, refs and working tree remain unchanged, no remote publication or secret error persistence occurs
    - id: SCN-canonical-fetch-boundaries
      given: Authentication or unknown errors, invalid limits, non-owner callers and a changing canonical destination
      when: CLI and service fetch paths are exercised
      then: Missing approval or invalid callers fail, permanent errors do not retry, transient exhaustion stops at the limit, changed policy stops another attempt and read-only status reports results
  observable_outcomes:
    - Real local bare Git remote, exact object presence, unchanged refs and worktree
    - SQLite attempt records and actual CLI JSON/status
    - Missing scenario markers reject candidate acceptance
  determinism_controls:
    - Disposable local Git repositories; transport failures injected at the executor boundary
    - No real remote or deployment exercised
  anti_cheat_rationale:
    prevents:
      - Sharing fetch retry semantics with push or deploy authority
      - Treating authentication failure as a transient network hiccup
      - Updating branches through implicit fetch refmaps
      - Persisting credential-bearing transport errors
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

Fixture correction: local canonical creation correctly rejected an uncommitted
installation, so the fixture now commits installation metadata before that gate.
Production uses the existing narrow owner-audit API and adds only the named
`canonical.fetch` permission; no identity or audit assertions were relaxed.

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-console-task-activity
      given: Old owner requests, blocked work, managed Git branches and missing history
      when: Activity is observed through the Console snapshot and rendered on the work board
      then: Owner requests sort first, metadata updates do not hide age, incomplete history remains unknown, blocked waiting is explicit, no task or Git mutation occurs
  observable_outcomes:
    - Real disposable Git history and read-only HTTP snapshot
    - Shared renderer escapes text, bounds lists and preserves closure as intent
    - Real browser demo shows owner-first activity review without live API calls
    - Missing scenario marker rejects candidate acceptance
  determinism_controls:
    - Fixed Git dates, explicit observation clock and disposable repositories
    - Isolated demo transport with all live API requests aborted
  anti_cheat_rationale:
    prevents:
      - Equating missing history with neglected work
      - Resetting inactivity through metadata edits
      - Mutating backlog or treating Closes text as completion
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-console-check-evidence
      given: Legacy and conditioned receipts, malformed frozen-input metadata and an unconfirmed running preparation
      when: Read-only project evidence is projected and rendered in the actual Console
      then: Invalid or absent evidence remains explicit, project isolation and text escaping hold, no database mutation occurs, private capture paths stay hidden
  observable_outcomes:
    - Project-scoped SQLite projection and shared escaped dashboard HTML
    - Real browser demo displays captured input and before/after observations
    - Missing scenario marker blocks candidate acceptance
  determinism_controls:
    - In-memory SQLite with explicit records and isolated demo transport
    - All live API calls blocked during the browser scenario
  anti_cheat_rationale:
    prevents:
      - Treating a running record as proof of a live executor
      - Treating missing conditions as independently verified runtime truth
      - Leaking capture paths or reading untrusted artifact paths
      - Escaping legacy schema support through observation-side migrations
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

Owner-briefing UI additions (2026-09-30): `SCN-console-owner-digest` tests
owner-first rendering, HTML escaping, ignored raw Markdown, evidence labels,
stale/future-clock/unpublished/unavailable/truncated states and no source mutation.
`SCN-demo-owner-digest` uses the existing isolated demo transport to prove that
an approval changes live sample state without rewriting the historical briefing
or another demo workspace. Both exact markers are candidate acceptance requirements
with missing-marker rejection. The real Playwright demo scenario additionally
checks actual briefing DOM, immutable publication after approval, desktop/mobile
screenshots, mobile anchor clearance above sticky navigation and expanded-evidence
width, while all live API requests are intercepted/aborted. Reduced-motion media
makes anchor-position assertions deterministic without sleeps. No previous
overflow assertion was weakened: two animation frames after viewport resize
allow responsive layout to settle before the existing strict width measurement.
No previous
assertion was relaxed; new fixtures use the actual TorchDemo factory and token
confirmation fields. Screenshots prompted the mobile anchor-spacing fix.

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-owner-digest
      given: Owner and peer approval waits, an old owner request and implementation-only work
      when: A read-only report is generated and explicitly published locally
      then: Owner waits lead, implementation is not shipping, escaped Markdown and bounded Git coverage preserve truthful reporting, and latest publication survives reopening and CLI/API reads
    - id: SCN-owner-digest-schedule
      given: Owner-approved typed system coordination schedule and enabled digest policy
      when: The action runs or publication policy is revoked
      then: A local report is stored with no external command or AI wake and the existing scheduler respects revocation
    - id: SCN-owner-digest-receipts
      given: Seeded recorded receipts across old, current and future windows plus uncertain later deployment
      when: Bounded reporting and publication encounter an audit failure
      then: Window/count/truncation and recorded decisions remain explicit, uncertainty is not live success and publication rolls back
  observable_outcomes:
    - Immutable local report and atomic publication audit, unchanged authoritative backlog
    - No outbound notification, provider wake or host timer installation
    - Markdown escaping, read-only no-store API and method rejection
    - Exact missing-scenario markers block candidate acceptance
  determinism_controls:
    - Disposable Git/worktree/database fixtures with fixed clock and recorded-history seeds
    - Receipt seeds test reporting, not independent deployment or landing qualification
    - No sleep, network provider or retry used to hide failures
  anti_cheat_rationale:
    prevents:
      - Calling landed or implemented work shipped
      - Inventing management decisions from undated documents
      - Reporting partial history as proven neglected work
      - Treating a local artifact as public publication or external delivery
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

New fixture corrections use the existing scheduler's canRun result and the
approval service's decidedBy argument. They do not weaken authority, revision,
policy-revocation or receipt assertions. The schema refinement now explicitly
permits only the owner-authorized typed owner-digest coordination action; it
does not permit arbitrary command actions to claim coordination behavior.

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-delivery-attempts
      given: Approved delivery policy and an explicitly retry-safe adapter
      when: Transient failures precede success or an executor throws with uncertain effects
      then: Attempts persist before execution, approval remains mandatory, success advances once, unknown effects block repeats and owner recovery preserves uncertainty
    - id: SCN-delivery-retry-boundaries
      given: Bounded retry policy and independent database callers
      when: Failures are permanent, safety is undeclared, the limit is reached or authority changes mid-operation
      then: No extra external invocation occurs and changed policy is observed by a long-lived service
    - id: SCN-delivery-succeeded-recovery
      given: A durable successful adapter receipt and interrupted local application
      when: The owner reviews and confirms a stopped executor after reopening the control plane
      then: Exact saved success is applied once without an adapter, destination/authority drift blocks it and recovery-audit failure rolls back while preserving receipts
  observable_outcomes:
    - Persisted operation and attempt records, shared idempotency key, unchanged failed lifecycle state
    - Independent control-plane connections refuse overlapping execution
    - Reopened state, CLI attempts and owner-attested recovery, bounded console observation
    - Existing lifecycle scenario still proves real Git/check/integration gates separately
    - Legacy schema migration preserves receipts; parent-running/latest-success crash window is recoverable
    - CLI preview/approval and replay produce no extra attempts or lifecycle events
  determinism_controls:
    - Disposable local repositories and deterministic in-process project adapter outcomes
    - Direct fixture placement at release-ready only for retry scenarios, explicitly not release qualification
    - No network calls, delays, host timers or live deployment
  anti_cheat_rationale:
    prevents:
      - Retrying uncertain side effects or hiding failed attempts
      - Advancing state after a failed adapter or bypassing owner approval
      - Counting provider declarations as independently verified behavior
      - Selecting latest fixture by ambiguous timestamps
      - Redeploying already-successful work after a local failure
      - Treating unknown outcomes as saved success or asserting provider receipt truth
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

Landed-closure additions (2026-09-30): `SCN-landed-task-closure` uses real
disposable Git worktrees/check receipts and proves opt-in closure after the
exact canonical landing, no closure before landing, manager-only authority,
wrong-owner/wrong-commit/unknown-item refusal, idempotent replay and fresh
check-policy invalidation. `SCN-landed-closure-recovery` holds an actual task
lock while landing, verifies durable landed state survives closure failure,
revokes automatic policy, tests read-only CLI preview and missing-approval
refusal, then explicitly retries closure without another Git landing.
Identity-bound MCP refuses specialist closure and unapproved manager mutation.
The existing bootstrap scenario now also requires generated specialist prompts
to name task IDs, treat trailers as intent and confirm landed/completed state;
these are additive assertions, not proof that a live model follows the prompt.
Both exact scenario markers are now required by candidate acceptance, including
negative missing-marker tests. No assertions were relaxed. Initial fixture
filename corrected from nonexistent project.json to actual tracked torch.yaml;
production source-area lookup uses the actual config.domains schema. These
tests do not qualify a live fleet or independently verify model behavior.

Commit-activity additions (2026-09-30): new tests only; no existing assertion
was removed or relaxed. Real disposable Git histories with fixed commit dates
exercise `SCN-backlog-commit-activity` (linked progress, owner-first neglect,
unchanged task state and clean working tree), `SCN-backlog-activity-coverage`
(bounded/missing history produces unknown, future commits cannot fake current
progress), and `SCN-commit-closure-intent` (only standalone trailers describe
intent, without executing text or completing tasks). Current-source candidate
acceptance requires all three exact scenario tokens; missing evidence fails
even when test commands exit green. Commit metadata is not implementation
proof. Automatic closure, host scheduling and live dashboard activity are not
claimed by these scenarios.

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-backlog-self-claim
      given: Default-disabled policy and explicitly routed ready work
      when: The owner permits one specialist and it resolves work
      then: Priority-ordered claims are audited to the specialist and existing work resumes even after revocation
    - id: SCN-backlog-self-claim-readiness
      given: Dirty work, guards, prepared checks, resource waits, approvals or integration
      when: The specialist requests its next assignment
      then: Work remains ready and concrete blockers are returned
    - id: SCN-backlog-self-claim-race
      given: Two local specialist processes and two ready tasks
      when: Both request work concurrently
      then: Exactly one task is assigned and the other call resumes or fails closed on contention
    - id: SCN-cli-backlog-self-claim
      given: Approved policy and a bound specialist
      when: CLI previews or confirms and MCP attempts another identity
      then: Preview preserves task revision, confirmation claims once, identity spoofing is rejected
    - id: SCN-backlog-blocked-resume-serialization
      given: One blocked task and a different active task owned by the same specialist
      when: The blocked task is resumed
      then: It remains blocked until the other active assignment ends
  observable_outcomes:
    - Tracked task JSON, revisions, state and specialist-attributed history/audit
    - Actual concurrent child processes, CLI JSON and identity-bound MCP responses
    - No assignment-only message generated for a self-claim
    - Exact marker verification rejects missing scenarios even when longer IDs share their prefix
  determinism_controls:
    - Disposable Git repositories and explicit persisted policy changes
    - Real project-scoped locks; lock contention is a fail-closed outcome, not a retry
  anti_cheat_rationale:
    prevents:
      - Bypassing assignment authority via a public selfClaim field
      - Granting work outside explicit routing or with incomplete dependencies
      - Claiming a second task after restart or blocked-task reactivation
      - Reading policy only once before the owner revokes it
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```
# Provider update preflight (2026-09-30)

Self-host packaging follow-up: extended the existing SCN-candidate-isolation
fixture with a tracked `.torch/torch.yaml`; assert it is absent from the engine
candidate while committed engine files and dependency symlinks remain present.
This adds a stricter no-project-state-shipping invariant without changing any
existing assertion. Update policy is validated under `runtimes.<name>.updatePolicy`,
which older readers already treat as extensible runtime data; no incompatible
top-level project key or permanent global provider setting is introduced.

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-provider-updates
      given: approved selected built-in providers and deterministic registry
      when: latest versions install and pass parser/version smoke checks
      then: registry launches exact managed binaries and fresh startup is offline
    - id: SCN-provider-update-cli
      given: installed project with owner-enabled update policy
      when: dry run, actual startup and failed stale refresh execute
      then: preview is offline, actual launch uses updated binary, failure cannot launch
    - id: SCN-provider-updates-recovery
      given: prior verified activation
      when: download fails, another updater owns lock or executable changes
      then: prior selection survives failure and unsafe or concurrent use is refused
    - id: SCN-provider-update-safety
      given: fixed official package allowlist and owned prefixes
      when: arbitrary name, injected version, escaped prefix or symlink store appears
      then: updater refuses without arbitrary install execution
  observable_outcomes:
    - persisted selected versions and exact launch commands
    - refusal codes and absence of downloads during preview or fresh-cache use
  determinism_controls:
    - isolated XDG roots, local Git fixtures and boundary installer runner
    - no provider accounts or live registry in regression tests
  anti_cheat_rationale:
    prevents: [unverified activation, global overwrite, silent stale fallback, arbitrary command injection]
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```
# Setup and canonical worktree briefs (2026-09-30)

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-guided-setup
      given: "An approved installed project with uncommitted TORCH files"
      when: "Owner reviews and authorizes setup"
      then: "Only owned files are committed; registered worktrees exist; no providers start; staged user work blocks setup"
    - id: SCN-worktree-canonical-brief
      given: "A registered worktree has older instructions"
      when: "Its installation root is resolved and a brief requested"
      then: "Canonical instructions appear; unregistered worktrees, copied installs and stale installation IDs fail closed"
    - id: SCN-install-restore
      given: "A normally detached project retains configuration and worktree commits"
      when: "Owner explicitly restores the install"
      then: "Binding is reattached without changing profiles, worktree history or launching providers"
  observable_outcomes:
    - "Git commits, clean canonical checkout, worktree registrations, brief text and local detach metadata"
  determinism_controls:
    - "Isolated temporary Git repositories and XDG state; no provider or network calls"
  anti_cheat_rationale:
    prevents:
      - "Hard-coded success without Git worktrees or commits"
      - "Accepting copied or unregistered installation state"
      - "Staging unrelated owner work"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```
# First live scheduler pilot: native systemd parser (2026-09-30)

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-systemd-native-unit
      given: "A generated dispatcher with a repository path containing spaces, percent and quote characters"
      when: "The real Linux systemd-analyze parser verifies the emitted service"
      then: "The service parses successfully and WorkingDirectory remains an absolute scalar path"
  observable_outcomes:
    - "Actual native parser exit status and generated unit bytes"
  determinism_controls:
    - "Temporary project path alias and unit file; /usr/bin/true command; verify-only, no service activation"
  anti_cheat_rationale:
    prevents:
      - "Mocked systemctl success masking invalid unit syntax"
      - "Treating quoted ExecStart syntax as valid for scalar WorkingDirectory"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

# Codex startup runtime diagnostics (2026-09-30)

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-codex-startup-diagnostics
      given: "A real Codex adapter and lifecycle plan receive deterministic nonzero child-process results"
      when: "Codex stdout contains a model-rejection event, malformed JSON, or output above the diagnostic bound"
      then: "Owner-visible failure details prefer the structured model rejection, redact stderr secrets and prompt fields, and label malformed or oversized output unknown with an explicit reason"
  observable_outcomes:
    - "FLEET_START_FAILED status, persisted offline identity state and owner-visible diagnostic details"
    - "Structured model rejection over noisy MCP stderr; explicit unknown outcomes without retained oversized stdout"
    - "No synthetic prompt, token or password value in serialized error details"
  determinism_controls:
    - "Disposable local Git/XDG fixtures and fixed injected child-process output"
    - "Real createCodexAdapter and startFleet boundary; no provider calls, retries, sleeps or network"
  anti_cheat_rationale:
    prevents:
      - "Returning a hard-coded success while losing the real nonzero execution status"
      - "Displaying unrelated MCP noise instead of a structured model rejection"
      - "Leaking raw prompt or credential values through diagnostics"
      - "Treating malformed or oversized stdout as trusted structured evidence"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

# Standalone dashboard artifact isolation (2026-10-01)

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-dashboard-artifacts
      given: "The dashboard test runs without an artifact environment, with an external runner directory, or with a repository/worktree target"
      when: "It chooses the screenshot output boundary before the browser or screenshot writer starts"
      then: "The default is a retained fresh external directory with provenance and hashes; explicit external output is honored; repository, temporary-root, pre-existing and symlink-resolved targets fail before protected bytes change"
  observable_outcomes:
    - "Printed artifact directory, provenance, relative names, byte counts and SHA-256 hashes"
    - "Refusal code for direct, temporary-root, existing-file and symlink-resolved tracked-worktree destinations"
    - "Unchanged tracked baseline and external user bytes after refusal"
  determinism_controls:
    - "Disposable Git worktrees and temporary directories"
    - "Fixed fixture bytes and SHA-256 assertions; no browser, network, sleep or retry is needed for the boundary scenarios"
  anti_cheat_rationale:
    prevents:
      - "Silently falling back to tracked golden-image paths"
      - "Bypassing repository protection through a symlink"
      - "Claiming runner output without exact retained evidence provenance"
      - "Masking a protected-write failure by changing golden assertions"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

# Console dashboard navigation and preview freshness (2026-10-01)

```yaml
test_integrity_note:
  change_type: [new_tests, refactor_tests]
  scenarios:
    - id: SCN-dashboard-fragment-navigation-preserves-existing-captures
      given: "The existing dashboard scenarios and eleven screenshot destinations run in their established order"
      when: "The driver selects each target section's supported fragment immediately before its unchanged checks and captures"
      then: "Each original assertion and capture executes against the selected view without changing capture order, viewport coverage, artifact destination, or artifact safeguards"
    - id: SCN-console-priority-preview-invalidates-on-newer-evidence
      given: "A task priority preview and unsent priority and reason values are created from task evidence revision N"
      when: "A separate confirmed sample API action advances that task to authoritative revision N+1, then the reader refreshes again after navigating away and back"
      then: "The revision N token, preview, and confirmation control remain absent; revision N+1 is visible, the unsent values remain intact and editable across both refreshes, a new preview is bound to N+1, and that current preview survives another unchanged refresh"
    - id: SCN-console-current-preview-and-draft-survive-unchanged-refresh
      given: "A task has an active priority preview and unsent priority and reason values bound to its current evidence revision"
      when: "Console refresh returns the same task revision"
      then: "The preview token, review panel, confirmation boundary, and unsent field values remain available unchanged"
    - id: SCN-console-view-navigation
      given: "The Console has addressable work, fleet, evidence, and flow-watch views"
      when: "A reader opens fragments, follows navigation, and uses browser Back and Forward"
      then: "Exactly one matching view is visible with the matching title, accessible current-page link, and persistent project and freshness context"
    - id: SCN-console-mobile-navigation
      given: "The Console is rendered at a 390x844 viewport"
      when: "Each supported destination is selected"
      then: "Every navigation destination remains visible and the document and navigation have no horizontal overflow"
    - id: SCN-console-view-title-mapping
      given: "The Console loads Overview and a reader selects each other supported view"
      when: "The reader returns to Overview after visiting contextual views"
      then: "Overview has the exact title TORCH Dashboard on initial and return navigation; all other views keep their exact contextual titles"
    - id: SCN-console-owner-briefing-evidence-limitation-stays-visible
      given: "The sample Console has a published owner briefing with reporting provenance"
      when: "The owner briefing is rendered without opening compact provenance details"
      then: "The warning that recorded evidence is not independent live verification remains visible, while exact publication time and reporting-window details stay in the collapsed disclosure"
    - id: SCN-console-secondary-deeplink-focus-and-history
      given: "The Console is loaded at the organization-proposals or approval-request-list fragment"
      when: "The reader opens either direct link and uses browser Back and Forward"
      then: "Exactly the matching view is selected and the actual secondary target is focused inside the viewport"
    - id: SCN-console-operational-deeplink-fleet
      given: "Operations, resources, schedules, providers, decisions, context, and manager-wakes are grouped in the Fleet workspace at 1280x900 and 390x844"
      when: "The reader loads #manager-wakes directly, follows its existing attention link, or returns to it through Back and Forward, then later navigates, scrolls, and refreshes"
      then: "After the first deterministic data/layout application Fleet is selected, the Operations disclosure opens, manager-wakes receives focus fully inside the viewport, a later refresh retains the user's selected view and scrolled position without refocusing manager-wakes, and Operations is hidden on unrelated views"
    - id: SCN-console-view-drafts
      given: "A task draft and an owner approval preview are present"
      when: "The reader changes views and refreshes the sample Console"
      then: "The unsent draft and same-revision preview remain available with their existing explicit owner confirmation boundary"
  observable_outcomes:
    - "Selected fragment, visible view, original assertion results, and the unchanged ordered screenshot set"
    - "Revision N+1 displayed after refresh, with the old preview token and confirmation control unavailable"
    - "Unsent priority and reason values retained and editable after newer evidence invalidates the old preview"
    - "The same draft remains dirty and intact after another unchanged refresh and route transition, with the old token and confirmation control still absent"
    - "An unchanged current-revision preview, confirmation boundary, and draft retained after refresh"
    - "A regenerated preview token and displayed revision bound to N+1"
    - "Exact Overview and contextual view titles, plus focused in-viewport secondary targets across direct loads and browser history"
    - "The manager-wakes route selects Fleet and opens/focuses its nested target fully inside desktop and mobile viewports after first render and across browser history; later refresh retains the user's selected view and scrolled position without refocusing manager-wakes; operations stay hidden outside Fleet"
    - "Visible recorded-evidence limitation beside owner briefing content while exact provenance remains compact and collapsed"
    - "No browser requests to live project APIs and no changes to tracked screenshot expectations"
  determinism_controls:
    - "The existing isolated sample Console, fixed Playwright clock, and fixed desktop/mobile viewports"
    - "Manager-wakes routing uses the existing isolated sample Console, a deterministic two-frame first-generation layout-completion marker, and browser fragment history without changing project state"
    - "The test establishes a fixed nonzero numeric scroll baseline, observes that exact position, dispatches the actual non-scrolling Refresh button event, waits for generation two, and retains the exact scroll-position equality assertion"
    - "Newer evidence is introduced through the sample's supported preview/confirm API before an explicit refresh"
    - "The browser test advances only the isolated sample API; it never submits the priority form or mutates a live project"
    - "No network, live project mutation, retry, sleep, timeout, golden update, or direct fixture-source change"
  anti_cheat_rationale:
    prevents:
      - "Capturing a view other than the one named by the scenario while retaining a passing screenshot call"
      - "Passing scroll-preservation coverage because an unsettled smooth-scroll or Playwright auto-scroll masks refresh movement"
      - "Reusing a revision N preview after authoritative task evidence advances to N+1"
      - "Treating an unchanged preview on refresh as proof of stale-preview invalidation"
      - "Passing because of changed screenshot expectations, weakened assertions, or bypassed artifact provenance"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

# Candidate engine and artifact sealing Phase A (2026-10-01)

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-candidate-engine-pure-fixture
      given: Hermetic frozen fixture descriptors, bounded command data, explicit environment and a fixture artifact directory
      when: The isolated Phase-A engine observes a child execution
      then: Only bounded parent-observed terminal data and a nonpromotable SourceAttestation are returned
    - id: SCN-artifact-manifest-seal
      given: Fixed regular artifact bytes in a hermetic temporary directory
      when: The parent seals the directory
      then: Canonical sorted paths, byte lengths and SHA-256 values are write-once and verify unchanged
  observable_outcomes:
    - Raw exit, error, signal, timeout and overflow observations; zero exit plus overflow is not success
    - No receipt identity, writer capability, registered-state handle or consumer eligibility
    - Capped canonical manifests and refusals for links, traversal, special files, overwrite and post-seal drift
  determinism_controls:
    - Fixed bytes, injected executors and isolated temporary directories
    - No retries, sleeps, network, registered control-plane state or provider process
  anti_cheat_rationale:
    prevents:
      - Hard-coded PASS or fixture receipt promotion
      - Ambient environment or registered-state capability leakage
      - Snapshot/golden rubber-stamping and unbounded output masking
      - Link, traversal, overwrite or post-seal artifact substitution
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

# Candidate engine and artifact sealing Phase A corrective boundaries (2026-10-01)

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-candidate-engine-boundary-limits
      given: "A fixture run with candidate execution limits"
      when: "A required bound is missing, zero, oversized, or supplied to the injected native-shaped executor"
      then: "Execution refuses before start or receives finite timeout and output caps without ambient defaults"
    - id: SCN-candidate-engine-utf8-overflow
      given: "A parent observes multi-byte UTF-8 output larger than its byte cap"
      when: "The child exits zero with output overflow"
      then: "Only a valid byte-bounded prefix is retained and the terminal observation is non-success"
    - id: SCN-candidate-engine-immutable-input-and-environment
      given: "A candidate input byte snapshot and explicit deterministic environment"
      when: "The digest or byte length is absent or mismatched, an unallowlisted environment is requested, or caller data mutates"
      then: "The run refuses before execution or preserves its independent immutable snapshot"
    - id: SCN-artifact-manifest-bytewise-and-caps
      given: "Fixed artifacts with bytewise-distinct UTF-8 paths and configured evidence limits"
      when: "The parent seals files at or beyond count, file, aggregate, path, and manifest limits"
      then: "Canonical UTF-8 byte ordering is stable and every over-limit artifact refuses"
    - id: SCN-artifact-manifest-root-and-manifest-boundaries
      given: "A candidate artifact root or final manifest path"
      when: "A link, directory/special node, pre-existing seal, or oversized manifest is encountered"
      then: "No path is followed or parsed as evidence and write-once sealing refuses"
    - id: SCN-artifact-manifest-complete-drift
      given: "A previously sealed manifest"
      when: "An artifact is added or the manifest is replaced"
      then: "Verification rejects drift or an invalid seal"
  observable_outcomes:
    - "UTF-8 retained bytes never exceed maxOutputBytes; overflow including exit zero is non-success"
    - "Missing or mismatched input byte snapshots, unallowlisted environment names, and invalid bounds do not invoke the executor"
    - "Manifest lstat/open/read caps, path ordering, link/special refusal, and seal-drift errors are externally observable"
  determinism_controls:
    - "Injected fixture executor, fixed byte buffers, temporary directories, and no ambient environment inheritance"
    - "No network, registered control-plane state, provider process, or live receipt adapter"
  anti_cheat_rationale:
    prevents:
      - "Character-count truncation retaining more bytes than the declared cap"
      - "Ambient or syntactically valid but unapproved environment capability leakage"
      - "Caller-supplied digest labels impersonating verified immutable input"
      - "Link-following, unbounded manifest parsing, locale-dependent ordering, or post-seal substitution"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

# Console attention advisory cohorts (2026-10-01)

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-attention-advisory-cohort-cardinality-and-exact-references
      given: "A fixed 49-task snapshot with equivalent stale or missing observed-commit findings in doctor and backlogHealth"
      when: "The read-only attention projection groups those findings"
      then: "Exactly one separately labelled advisory/recheck cohort contains the exact 49 task references and retains each owner, observedAt, current observed commit, and UNKNOWN reproduction status"
    - id: SCN-attention-advisory-provenance-and-semantic-conflicts
      given: "Doctor and backlogHealth findings that either match or differ in task, code, owner, observedAt, current observed commit, or reproduction status"
      when: "The cohort uses the complete semantic fingerprint"
      then: "Equal findings retain both provenance sources once; any differing fingerprint field remains a separate visible observation"
    - id: SCN-attention-advisory-does-not-hide-owner-or-fleet-risks
      given: "An advisory warning alongside an unsafe error, schema error, unknown wake, delivery operation, and owner-addressed pending decision"
      when: "Attention is projected"
      then: "Only the intended stale/missing warnings enter Advisory; the owner decision remains Owner action and all unsafe, schema, wake, and delivery findings remain Fleet action"
    - id: SCN-attention-advisory-projection-is-read-only
      given: "A frozen snapshot containing an advisory finding and a revisioned owner decision preview boundary"
      when: "The attention projection runs"
      then: "Snapshot, decision evidence, preview token, revision, and draft remain unchanged; projection invokes no acknowledgement, close, recovery, or decision action"
    - id: SCN-attention-advisory-unknown-fields-stay-unknown
      given: "A stale/missing observation whose owner, observedAt, and current commit provenance are absent"
      when: "The advisory drilldown is formed"
      then: "The task reference remains visible while missing owner and provenance remain null and reproduction is labelled UNKNOWN"
  observable_outcomes:
    - "One 49-reference advisory cohort replaces duplicated stale/missing attention cards while preserving exact drilldown references"
    - "A populated advisory group remains enumerable and JSON-serializable; an empty projection preserves its original owner/fleet/arbiter object shape"
    - "Each deduplicated observation retains doctor and backlogHealth provenance; conflicting records are never merged by code alone"
    - "Owner decisions, unsafe recovery, schema errors, unknown wakes, delivery operations, and same-code errors remain in their existing action groups"
    - "Observed source/revision displays the exact observedAt SHA without presenting it as a clock timestamp"
    - "Projection does not mutate snapshot data or invoke state-changing actions, and existing owner quick-action preview/revision/draft assertions remain unchanged"
    - "Source/scenario qualification is not actual live desktop/mobile visual acceptance"
  determinism_controls:
    - "Fixed hermetic task IDs, owner values, observedAt values, observed commit, finding codes, and provenance inputs"
    - "Deep-frozen projection snapshots and an isolated demo serving one fixed in-memory snapshot; no existing fixture source, network, live project mutation, retries, or sleeps"
  anti_cheat_rationale:
    prevents:
      - "Hard-coded cohort counts that omit or invent task references"
      - "Deduplication by code alone that merges conflicting observations"
      - "Discarding one source while presenting a deduplicated observation"
      - "Hiding unsafe errors or owner decisions inside advisory summaries"
      - "Changing preview, revision, draft, or acknowledgement behavior while rendering evidence"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

# Compact Console Overview density (2026-10-01)

```yaml
test_integrity_note:
  change_type: new_tests
  scenarios:
    - id: SCN-console-overview-owner-decisions-and-urgent-hazards-lead-with-distinct-counts
      given: "An owner-addressed pending decision, unsafe Fleet findings, a manager-wake reservation, and advisory evidence"
      when: "The Console renders its Overview attention summary"
      then: "Owner decisions and urgent hazards lead, exact owner/action/advisory counts stay distinct, and only the guarded owner decision shortcuts appear"
    - id: SCN-console-overview-clean-unique-commits-stay-informational-and-unsafe-workstays-reviewable
      given: "One clean branch-ahead worktree and a separate dirty worktree"
      when: "The Overview projects worktree evidence"
      then: "Unique commits remain informational and inspectable while dirty work remains a named review finding"
    - id: SCN-console-overview-crowded-preview-preserves-every-fleet-and-advisory-record-at-desktop-and-mobile
      given: "A fixed 49-reference advisory cohort with one conflicting observation and 17 Fleet findings including unknown ownership and long evidence"
      when: "The Overview is measured at 1440x1000 and 390x844 and View all Fleet opens the full queue"
      then: "Shown/total/remaining counts are exact, urgent findings stay visible, every Fleet record and all advisory provenance/conflicts/unknowns remain reachable, and no horizontal overflow or clipped record occurs"
    - id: SCN-console-overview-refresh-and-navigation-preserve-owner-drafts-without-adding-unsafe-actions
      given: "An unsent task draft and a pending owner decision in the isolated demo"
      when: "The owner navigates away and refreshes the Console"
      then: "The draft remains intact, the owner shortcut boundary remains explicit, and no acknowledgement, close, recovery, or non-owner decision action is introduced"
    - id: SCN-console-overview-retains-ten-destinations-keyboard-routing-and-manager-wake-deep-links
      given: "The ten existing Console view destinations and an urgent manager-wake finding on a mobile viewport"
      when: "The owner uses keyboard navigation and opens the manager-wakes route directly and through browser history"
      then: "Each route selects its owning view, nested targets receive focus, Back/Forward remain coherent, and the urgent manager-wakes target is reachable"
  observable_outcomes:
    - "Owner and urgent counts are separate from advisory counts and clean unique commits do not inflate hazards"
    - "A bounded Fleet preview states exact shown, total, and remaining values and links to every original Fleet record"
    - "The full queue retains long evidence, conflicting advisory observations, exact task references, source provenance, and unknown ownership"
    - "The ten existing destinations, guarded owner action, drafts, mobile keyboard focus, and manager-wakes deep link remain observable"
    - "Fixed crowded data has no horizontal overflow or clipped urgent/evidence content at 1440x1000 and 390x844"
  determinism_controls:
    - "Hermetic loopback Console server with the isolated in-memory demo snapshot replaced by fixed task, owner, finding, evidence, and commit values"
    - "Fixed Playwright viewport dimensions and deterministic route/history actions; no live project mutation, external service, retry, or sleep"
  anti_cheat_rationale:
    prevents:
      - "Hard-coded preview/count labels that omit original findings"
      - "Hiding urgent or unknown-owner evidence behind advisory totals"
      - "Classifying clean unique commits as unsafe work"
      - "Losing conflicting source observations or inventing provenance"
      - "Adding owner actions that bypass the existing decision preview boundary"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```
