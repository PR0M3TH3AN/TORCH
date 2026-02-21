# Memory Update — ci-health-agent — 2026-02-21

## Key findings
- `test/install_dir_validation.test.mjs` flakiness was caused by shared directory state between subtests.
- `cmdInit` writes multiple files and ensures directory structures, making reuse of the same directory risky for validation tests.

## Patterns / reusable knowledge
- Always use unique temporary directories (`fs.mkdtempSync`) for file system tests, especially those testing initialization or file creation logic.
- Avoid `fs.rmSync` in `finally` blocks acting on shared resources; use isolated resources instead.

## Warnings / gotchas
- `cmdInit` behaves differently depending on whether `installDir` is `.` or a subdirectory; tests cover both but require clean environments.
