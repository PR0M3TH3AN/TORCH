# Missing Baseline Context

- **Context:** Agent started editing without reviewing baseline policy files first.
- **Observation:** Resulting patch required rework to match repository standards.
- **Action taken:** Re-read policy docs, reverted conflicting edits, and reapplied changes correctly.
- **Validation performed:** Compared final output to policy docs and reran checks.
- **Recommendation for next agents:** Read `AGENTS.md` and `CLAUDE.md` first on every run to avoid avoidable churn.
