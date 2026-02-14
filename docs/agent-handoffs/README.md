# Agent Handoffs

This directory stores reusable context so future agents can work faster without repeating discovery.

## Directory purpose

- `learnings/`: successful patterns, proven fixes, and repeatable implementation guidance.
- `incidents/`: failures, root causes, mitigations, and prevention guidance.

## When to write a note

Create or update a note when your work reveals knowledge that is likely useful in future sessions.

Examples:

- A reliable fix pattern that could be reused.
- A recurring failure mode and its mitigation.
- A non-obvious validation approach that prevented regressions.

If the issue is still active/reproducible, also update `KNOWN_ISSUES.md`.

## Naming convention (generic)

Use:

- `YYYY-MM-DD-short-topic.md`

Examples:

- `2026-02-14-validation-before-summary.md`
- `2026-02-14-missing-baseline-context.md`

Naming tips:

- Keep names descriptive and concise.
- Avoid product, team, customer, and environment names unless essential.
- Prefer neutral technical terms.

## Required note structure

Every learning/incident note should include the following headings:

1. Context
2. Observation
3. Action taken
4. Validation performed
5. Recommendation for next agents

## Writing guidelines

- Keep entries short and actionable.
- Prefer bullets over long narrative.
- Include exact commands when useful for reproduction.
- Avoid secrets, credentials, and user-identifying details.
- Distinguish facts from assumptions.

## Maintenance workflow

1. Search for an existing related note.
2. Update it if it already covers your case.
3. Otherwise, add a new note using the naming convention.
4. Cross-link related notes when helpful.
