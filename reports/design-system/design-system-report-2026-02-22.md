# Design System Audit Report — 2026-02-22

Headline: ⚠️ 18 violations (No PR opened)

## 1) Inline styles
- **Total count**: 14
- **Top sample files**:
  - `landing/index.html`: 14
- **First snippet example**:
  - `landing/index.html:158`: `<h2 class="mb-8 text-text-strong" style="font-size: 2rem;">Choose Your Agent</h2>`

## 2) Raw lengths
- **Total count**: 0 (excluding `dashboard/styles.css` which defines the system)
- **Note**: `dashboard/styles.css` contains px values but appears to be the source of truth/tokens.

## 3) Hex colors
- **Total count**: 4
- **Top sample files**:
  - `landing/index.html`: 4
- **First snippet example**:
  - `landing/index.html:32`: `background: #0d1117;`

## 4) Tailwind palette
- **Total count**: 0

## 5) Bracket utilities
- **Total count**: 0

## Footer
- **Commands run**: `npm run lint`, `grep` scans for inline styles/hex/px.
- **Exit status**: Lint passed (0). Audit found violations in `landing/index.html`.
- **Next steps**:
  - Refactor `landing/index.html` to use classes/tokens instead of inline styles and raw hex colors.
  - Verify if `dashboard/styles.css` variables are available to `landing/index.html` or if `landing/` needs its own stylesheet.
