# Test integrity note — TASK-console-attention-actions

```yaml
test_integrity_note:
  change_type: [new_tests]
  scenarios:
    - id: SCN-console-attention-owner-shortcut
      given: "A pending approval names the project owner and has an available decision form."
      when: "The owner chooses an Approve or Reject shortcut from its attention card."
      then: "Only the matching decision field is selected and the existing preview path starts; no decision is submitted directly."
    - id: SCN-console-attention-shortcut-drafts
      given: "The form is unavailable, has an active preview, or contains the opposite decision draft."
      when: "An attention shortcut is selected."
      then: "The action is declined with an explicit status and existing draft or preview values remain unchanged."
    - id: SCN-console-attention-ownership
      given: "An approval is pending for the owner or another named approver."
      when: "Attention actions are projected."
      then: "Only the owner-addressed item carries an owner decision shortcut identifier."
  observable_outcomes:
    - "Owner attention cards expose Approve and Reject controls only for pending requests addressed to owner."
    - "A shortcut enters the existing revision/evidence preview and confirmation flow."
    - "Missing forms, active previews, and conflicting drafts remain visible and unchanged."
    - "Long evidence is available through a compact expandable disclosure."
  determinism_controls:
    - "Projection and shortcut scenarios use fixed in-memory fixtures without clock, network, or randomness."
  anti_cheat_rationale:
    prevents:
      - "direct decision submission without preview and confirmation"
      - "peer approval authority exposed as an owner control"
      - "overwriting a pending decision draft or preview"
      - "long evidence silently omitted from compact cards"
  relaxation:
    did_relax_any_assertion: false
    if_true_explain_spec_basis: ""
```

Existing approval-console scenarios continue to cover stale revisions, named-approver enforcement, preview confirmation, and failed decisions. The attention tests add coverage at the UI projection and shortcut boundary; actual desktop/mobile visual acceptance remains separate and incomplete until a real browser capture is available.
