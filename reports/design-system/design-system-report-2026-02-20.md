# Design System Remediation Report (2026-02-20)

Headline:
- `⚠️ 2 violations` (PR opened for safe fixes)

## 1) Inline styles
- Total count: 1
- Top 10 sample files (file:count):
  - dashboard/app.js:1
- First snippet example (1–2 lines) with file:line:
  - `dashboard/app.js:544`: `bar.style.width = `${ttlPct}%`;`

## 2) Raw lengths
- Total count: 0 (outside of CSS file definitions)

## 3) Hex colors
- Total count: 1
- Top 10 sample files (file:count):
  - dashboard/styles.css:1
- First snippet example (1–2 lines) with file:line:
  - `dashboard/styles.css:91`: `.text-white { color: #fff; }`

## 4) Tailwind palette
- Total count: 0

## 5) Bracket utilities
- Total count: 0

## Footer
- Links to PR(s) or Issue(s) created: PR to be opened.
- Commands run + exit status: `npm run lint` (exit 0)
- Next steps:
  - Apply safe fixes for `text-white` hex color.
  - Fix mismapped `text-accent-strong` token usage in `styles.css`.
  - Monitor `dashboard/app.js` for more inline style usage.
