# Single Distribution Path: GitHub Tarball

## Context
- Installation docs previously mixed npm-style wording with GitHub source installs.
- This caused confusion because the package is not published to the npm registry.

## Observation
- `README.md` and `landing/index.html` are the two primary user-facing install surfaces.
- Any npm-registry wording in either location risks reintroducing broken install expectations.

## Action taken
- Standardized both surfaces to one install path:
  - `npm install https://github.com/PR0M3TH3AN/TORCH/archive/refs/heads/main.tar.gz`
- Added explicit README guidance that TORCH is distributed via GitHub tarballs and is not on npm registry.
- Updated CLI examples to `npx --no-install` so examples only use locally installed binaries.

## Validation performed
- Searched docs/UI sources for install phrasing and npm-registry implications.
- Verified updated install command appears consistently in README and landing page.

## Recommendation for next agents
- Treat GitHub tarball install as the canonical distribution path unless a real npm publish workflow is added.
- If distribution changes in the future, update `README.md`, `landing/index.html`, and this learning note in the same PR.
