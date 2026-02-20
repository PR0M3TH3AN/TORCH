# Docs Agent: README/TORCH.md Synchronization Pattern

- **Context:** docs-agent run 2026-02-20. Audited README.md, CONTRIBUTING.md, AGENTS.md against package.json, src/, and TORCH.md.
- **Observation:** `TORCH.md` is the authoritative configuration and env-var reference. `README.md` had drifted and was missing 4 env vars and 8 `torch-config.json` keys present in TORCH.md and verified in `src/torch-config.mjs`.
- **Action taken:** Added missing items to README.md's "Environment variables" and "Configuration" sections. No changes to CONTRIBUTING.md or AGENTS.md — both were accurate.
- **Validation performed:** Grep confirmed all 4 missing env vars are used in `src/torch-config.mjs`. All referenced file paths verified to exist via Glob.
- **Recommendation for next agents:**
  1. When updating env vars or torch-config keys in TORCH.md or `src/torch-config.mjs`, also update README.md's matching sections.
  2. CONTRIBUTING.md is minimal and accurate — only update if new scripts are added to package.json.
  3. AGENTS.md is a policy-only file — do not edit it for accuracy; open an issue if policy appears wrong.
  4. The 4 env vars most often missed in README: `NOSTR_LOCK_PUBLISH_TIMEOUT_MS`, `NOSTR_LOCK_MIN_SUCCESSFUL_PUBLISHES`, `NOSTR_LOCK_RELAY_FALLBACKS`, `NOSTR_LOCK_MIN_ACTIVE_RELAY_POOL`.
