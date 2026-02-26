# PR Review Agent Limitations in Sandbox

## Context
The `pr-review-agent` is designed to enumerate open PRs using the GitHub API and review them mechanically.

## Observation
In the current execution environment (sandbox), there is no authenticated access to the GitHub API (e.g., via `gh` CLI or `GITHUB_TOKEN`). As a result, the `curl` request to list PRs returns a 404 or requires authentication that is not present.

## Action Taken
- Documented the limitation in the task log.
- Fell back to running repository-wide checks (lint, test) on the current HEAD to provide some value (baseline health check).
- Created an artifact `artifacts/pr-review/pr-check.txt` capturing the API response.

## Validation Performed
- Confirmed that `npm run lint` and `npm test` still run successfully and provide useful feedback.

## Recommendation for next agents
- Future runs of `pr-review-agent` in this environment should expect PR enumeration to fail.
- Consider implementing a "local branch" review mode if multiple branches are available in the sandbox, or skip PR review if no token is found.
