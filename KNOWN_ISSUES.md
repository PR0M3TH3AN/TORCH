# Known Issues

<<<<<<< Updated upstream
Track active, reproducible issues in a reusable format.
=======
## Tests
>>>>>>> Stashed changes

### Skipped Tests

<<<<<<< Updated upstream
- Keep entries short, factual, and current.
- List active issues only; remove resolved items promptly.
- Link to related incident/handoff notes for deeper details.
- Prefer one entry per distinct issue.
=======
The following tests are skipped due to flakiness or environmental issues and should be investigated:
>>>>>>> Stashed changes

_No skipped tests currently documented._ (Last checked: 2026-02-13)

### Visual Regression Tests (`test:visual`)

<<<<<<< Updated upstream
- **Status:** Open | Monitoring | Mitigated
- **Area:** Build | Test | Tooling | Runtime | Docs | Other
- **Symptom:**
- **Trigger/Conditions:**
- **Workaround:**
- **Impact:**
- **Related notes:** `docs/agent-handoffs/incidents/...`
- **Last verified:** YYYY-MM-DD
=======
- **Artifact Retention**: Visual tests are configured to retain screenshots, traces, and videos on failure to assist with debugging. These artifacts can be found in `artifacts/test-results/`.
- **Note**: Visual tests are passing as of 2026-02-12. (Agent verified 2026-02-13: Environment lacks `@playwright/test` dependency to run verification).
>>>>>>> Stashed changes

## Environment

### Playwright Browsers

- **Issue**: Visual and E2E tests (`npm run test:visual`, `npm run test:e2e`) may fail with `browserType.launch: Executable doesn't exist`.
- **Workaround**: Run `npx playwright install` to download the required browser binaries if you are running tests outside of the pre-configured dev container or CI environment. (Last checked: 2026-02-13)
