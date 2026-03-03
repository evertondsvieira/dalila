# Upgrade Guide

Guidance for upgrading Dalila versions safely.

## Upgrade workflow (recommended)

1. Read `CHANGELOG.md` (`Unreleased` + target version).
2. Search for breaking/security-sensitive APIs used by your app:
   - `d-html`
   - `fromHtml`
   - `d-attr-*` on URL/HTML attributes
   - HTTP client XSRF behavior
3. Run your full test suite.
4. Run route/page smoke tests.
5. Deploy gradually (staging/canary) before full rollout.

## Compatibility notes (recent hardening)

### `d-attr-on*` is blocked

If your app used inline event handler attributes via `d-attr-onclick` (or similar), it must be migrated to `d-on-*`.

```html
<!-- Before -->
<button d-attr-onclick="handlerCode"></button>

<!-- After -->
<button d-on-click="handler"></button>
```

### `d-attr-*` disallowed URL protocols are blocked

Common URL attributes (`href`, `src`, `formaction`, etc.) now allow only a small safe protocol set (`http:`, `https:`, `mailto:`, `tel:`, `sms:`, `blob:`) plus relative URLs.

Values such as `javascript:...`, `vbscript:...`, `data:...`, and `file:...` are blocked.

If you were relying on dynamic URL strings, validate/normalize them before binding.

### XSRF headers are same-origin only

Dalila now attaches XSRF headers only for same-origin unsafe requests by default.

If your app intentionally sends requests to another origin, do not rely on automatic XSRF header injection.

### Default runtime security baseline is stricter

By default:
- `security.strict` is enabled
- `d-html` stays sanitized with Dalila's default sanitizer
- raw HTML attributes like `srcdoc` are blocked

`d-html` only renders empty and warns when you explicitly disable `useDefaultSanitizeHtml` and still leave `security.requireHtmlSanitizerForDHtml` enabled without providing a custom `sanitizeHtml` policy.

Review raw HTML usage before upgrading. For stricter tenant policies, configure a custom sanitizer. If you intentionally need blocked raw HTML attributes, override the runtime security options explicitly for that scope.

## Breaking change checklist (app maintainers)

- [ ] Replace `d-attr-on*` with `d-on-*`
- [ ] Review `d-attr-href/src/formaction/...` sources
- [ ] Review `d-html` sources and decide whether the default sanitizer is sufficient or a custom `sanitizeHtml` policy is required
- [ ] Review cross-origin HTTP calls with `xsrf: true`
- [ ] Update tests for new guardrails/warnings
