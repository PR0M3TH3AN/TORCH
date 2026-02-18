## Testing & Validation: Scenario-First, Cheat-Resistant (Dark Factory Rules)

You are operating inside a “Dark Factory” workflow where **validation replaces human code review**. Passing tests is only meaningful if tests are truthful.

### Prime directive

**Never alter a test merely to make it pass.**
If you change tests to match buggy behavior, you are destroying the only feedback signal and producing code with no real-world value.

StrongDM describes the exact failure mode we are preventing: agents discovering shortcuts (“return true”) and narrow tests being reward-hacked, leading to a shift from “tests” to scenario-based validation. :contentReference[oaicite:3]{index=3}

### How to think about tests here

Tests are not procedural checklists. They are **behavioral specifications**:
- Write tests as **scenarios** (Given/When/Then or equivalent).
- Assert **externally observable outcomes** at boundaries.
- Avoid “testing the implementation” (internal call sequences, private methods, mirrored logic).
- Prefer deterministic/harmonic execution: fixed seeds, controlled clocks, hermetic IO, virtualized dependencies.

### Prohibited behaviors (reward-hacking patterns)

Do NOT:
- weaken assertions, broaden tolerances, or reduce coverage to get green
- update snapshots/goldens without proving the change is intended behavior
- add retries/sleeps/timeouts to hide flakes
- mock so heavily that tests can pass with a broken system
- “hard-code to the test” (single fixtures, single input paths, brittle constants)

### Allowed test changes: Spec Correction Protocol

You may change test expectations only if the test is wrong relative to intended behavior.

Required steps:
1) Identify the scenario/spec that defines correct behavior.
2) Explain why the previous expectation was incorrect.
3) Replace it with an equally strict (or stricter) behavioral assertion.
4) Provide a **Test Integrity Note** (machine-readable) documenting the change.

If you cannot justify a change with scenario/spec truth: **do not change the test**. Instead, output a “Needs Spec Clarification” note and propose candidate scenarios.

### Required output when you touch tests

Include this YAML block in your PR description (or reference it from a `TEST_INTEGRITY.md` entry):

```yaml
test_integrity_note:
  change_type: ["new_tests" | "refactor_tests" | "spec_correction" | "flake_fix"]
  scenarios:
    - id: SCN-<slug>
      given: "<preconditions>"
      when: "<stimulus>"
      then: "<observable outcomes>"
  observable_outcomes:
    - "<boundary/output asserted>"
  determinism_controls:
    - "<fixed seed / fake clock / hermetic env / service virtualization>"
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

### If external services are involved

Prefer boundary-level service virtualization (“digital twins” / behavioral clones) so scenario tests remain:

* high fidelity (realistic edge cases)
* deterministic and replayable
* not rate-limited / not flaky

(StrongDM’s “Digital Twin Universe” is the reference pattern.) ([factory.strongdm.ai][2])

### Clean Repo Standard

*   **No Root Clutter**: Do not create logs, artifacts, or temporary files in the repository root.
*   **Structured Output**: Use `reports/`, `test_logs/`, `task-logs/`, or `artifacts/` as appropriate.
*   **Redirect Output**: If a command writes to root, redirect it (e.g., `cmd > test_logs/output.txt`).
