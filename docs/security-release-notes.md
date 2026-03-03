# Security Release Notes

## 2026-03-03 (Security hardening sprint)

### Fixed

- Form path parsing now blocks unsafe segments (`__proto__`, `prototype`, `constructor`) to prevent prototype pollution in nested form parsing.
- HTTP XSRF headers are now attached only to same-origin unsafe requests by default, with the decision applied after `onRequest` interceptors.
- Inline preload scripts now escape HTML script-context breakouts (e.g. `</script>`) in both runtime preload helpers and the dev server.
- Dev server URL decoding now handles malformed percent-encoding safely instead of crashing on `decodeURIComponent`.
- `d-html` now applies a built-in baseline sanitizer by default (custom `sanitizeHtml` still overrides).

### Developer-facing notes

- Prefer `{token}` / `d-text` for untrusted content.
- For strict policies in multi-tenant apps, configure `sanitizeHtml` with an allowlist-based sanitizer (for example DOMPurify).
- `fromHtml()` should be treated as trusted template markup input, not a sink for user-generated HTML strings.
