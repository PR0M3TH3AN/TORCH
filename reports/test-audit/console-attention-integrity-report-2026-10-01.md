# Console attention test integrity

```yaml
test_integrity_note:
  change_type: ["new_tests"]
  scenarios:
    - id: SCN-console-attention-ownership
      given: "Pending approvals name either the project owner or another approver"
      when: "The Console projects attention groups"
      then: "Only owner-addressed decisions appear under Waiting on you; peer approvals route to their named approver without approve or reject actions"
    - id: SCN-console-attention-dedup
      given: "Doctor and snapshot evidence describe the same unacknowledged message queue"
      when: "Attention items are projected"
      then: "One aggregate message item appears with the higher observed count and recipient-owned acknowledgement guidance"
    - id: SCN-console-attention-worktrees
      given: "A worktree has unique commits, local changes, or an active Git operation"
      when: "Attention items are projected"
      then: "Findings group by identity and branch/path; retained commits remain labeled as progress while unsafe operations remain review findings"
    - id: SCN-console-attention-wait-reasons
      given: "A task is blocked and repository recovery has no off-machine copy"
      when: "The Console projects attention"
      then: "The recorded block reason and single-disk recovery consequence remain visible with the responsible domain"
    - id: SCN-console-attention-empty
      given: "Approval evidence is unavailable and no queue or doctor finding is observed"
      when: "Attention items are projected"
      then: "No synthetic owner decision or operational issue is created"
  observable_outcomes:
    - "Attention groups distinguish owner decisions, Fleet work, and arbiter work"
    - "Approval action ownership follows the named approver"
    - "Repeated message queue evidence produces one item"
    - "Worktree progress and unsafe Git state have distinct descriptions"
    - "Unknown evidence stays explicit rather than gaining an invented owner"
  determinism_controls:
    - "Tests pass fixed in-memory snapshots; no clock, network, or filesystem is consulted"
  anti_cheat_rationale:
    prevents:
      - "hard-coded return value"
      - "over-mocking internal logic"
      - "snapshot rubber-stamping"
      - "retry/sleep-based flake masking"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

The focused attention scenarios passed. The existing owner approval scenario did not start because this worktree lacks the installed `zod` dependency; no assertion was changed or skipped in its source.
