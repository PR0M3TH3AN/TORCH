# Docs Alignment Update: Scheduler Scripts

Context:
- `README.md` and `TORCH.md` were missing documentation for key development scripts: `scheduler:daily`, `scheduler:weekly`, and `lock:complete`.

Observation:
- These scripts exist in `package.json` and are critical for testing the scheduler cycle locally.
- `lock:complete` is essential for manual lock release during debugging.

Action Taken:
- Added `npm run scheduler:daily`, `npm run scheduler:weekly`, and `npm run lock:complete` to the "NPM Scripts (for development)" sections in both `README.md` and `TORCH.md`.

Recommendation:
- Future agents should check `package.json` scripts when updating documentation to ensure parity.
