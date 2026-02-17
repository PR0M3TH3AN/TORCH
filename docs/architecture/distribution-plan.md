# TORCH Distribution Strategy: Hybrid "Drop-in"

## Goal
To make TORCH the universal "operating system for AI agents" across all languages and environments, we must remove the dependency on Node.js/NPM for end users while maintaining a robust development experience for contributors.

## The Problem
Currently, TORCH is distributed as a tarball that requires `npm install`. This assumes:
1.  The user has Node.js installed.
2.  The user is comfortable with `package.json` and `node_modules`.
3.  The project is a JavaScript/TypeScript project.

For Python, Go, or Rust developers, this is friction. A "drop-in" tool should work without language-specific prerequisites.

## The Solution: Hybrid Distribution

We will support three primary distribution methods to cover all use cases:

### 1. The Official NPM Package (Current)
**Target Audience:** Node.js / TypeScript developers.
**Experience:** `npm install torch-lock` (or similar).
**Pros:** seamless integration with existing JS toolchains, easy updates via dependabot/renovate.

### 2. Standalone Binary CLI (New)
**Target Audience:** Python, Rust, Go, and non-Node developers.
**Experience:** Download a single binary (`torch`) from GitHub Releases and add it to `$PATH`.
**Implementation:**
- Use Node.js Single Executable Applications (SEA) or `pkg` to compile the JS source into binaries for Linux, macOS, and Windows.
- **Zero Dependencies:** No `npm`, no `node_modules`.
- **Fast:** Instant startup, no install process.

### 3. Hosted Dashboard (New)
**Target Audience:** All users (especially those using the binary).
**Experience:** A static web app hosted at a public URL (e.g., `dashboard.torch.sh` or GitHub Pages).
**Workflow:**
1.  User runs `torch lock ...` locally.
2.  CLI prints: `View active locks: https://dashboard.torch.sh/?hashtag=my-project-hash`
3.  User clicks the link to see the dashboard.
**Features:**
- **Stateless:** The dashboard is a static HTML/JS file.
- **Client-side Logic:** It connects directly to Nostr relays from the browser.
- **URL Configuration:** Configuration (hashtag, namespace, relays) is passed via URL query parameters, making links shareable.
- **Local Persistence:** Settings are saved to `localStorage` for returning visitors.

## Benefits
-   **Universal Access:** Removes the Node.js barrier to entry.
-   **True "Drop-in":** The binary + hosted dashboard requires *zero* local setup beyond downloading one file.
-   **Maintainability:** The core logic remains in JavaScript/Node.js, shared across all three distribution methods.
