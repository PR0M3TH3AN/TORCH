# Memory Update — innerhtml-migration-agent — 2026-02-22

## Key findings
- scripts/check-innerhtml.mjs is read-only and does not support --update or BASELINE updates.
- landing/index.html uses innerHTML for rendering agent cards and error messages.

## Patterns / reusable knowledge
- Use `element.replaceChildren()` to clear content instead of `innerHTML = ''`.
- Use `document.createElement` and `textContent` to safely construct DOM elements.
- Use `element.onclick = () => func()` instead of `onclick="func()"` strings for better security.

## Warnings / gotchas
- Verify tools before assuming they have write capabilities (like check-innerhtml.mjs).
- Ensure `escapeHtml` is not needed if using `textContent`.
