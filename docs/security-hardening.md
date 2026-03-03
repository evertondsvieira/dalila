# Security Hardening Guide

Dalila now ships with a secure baseline enabled by default so common web apps do not need a manual security bootstrap before going live.

Use this guide to understand what is already on, what still needs app-specific review, and how to tighten or relax the defaults.

## 1. Default production profile

When you import the runtime, Dalila now restores this baseline by default:

- `security.strict: true`
- `security.blockRawHtmlAttrs: true`
- `security.requireHtmlSanitizerForDHtml: true`
- default `sanitizeHtml` active for `d-html`
- framework-level security observability for reactive runtime errors

The default sanitizer behavior is:

1. Prefer a global DOMPurify instance when one is available (`DOMPurify` or `createDOMPurify(window)`).
2. Fall back to Dalila's built-in baseline sanitizer when DOMPurify is not available.

That means `d-html` stays sanitized even without manual `configure(...)`.

## 2. What the framework now protects by default

### Runtime

- `d-html` always goes through the default sanitizer unless you override it.
- Dangerous URL sinks such as `javascript:` stay blocked.
- Raw HTML attributes such as `srcdoc` are blocked in the default strict profile.
- `configure({})` resets back to Dalila's secure defaults instead of an empty config.

### Dev server

`scripts/dev-server.cjs` now sends security headers by default:

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- `X-Frame-Options: DENY`
- `Cross-Origin-Opener-Policy: same-origin`

The dev CSP remains permissive enough for HMR and inline dev injection, but it closes obvious gaps such as unrestricted object/embed execution and inline event attributes.

### CLI

`dalila check` now also runs a basic security smoke pass automatically. It fails on obvious dangerous template patterns such as:

- inline `on*=` handlers
- `javascript:` URLs in executable attributes
- executable `data:` URLs such as `data:text/html,...`

It also warns on raw sinks that need explicit review:

- `d-html`
- `srcdoc`
- `fromHtml()`
- direct `innerHTML` / `outerHTML` style writes in source files

### Observability

Reactive runtime security failures are now logged with a dedicated `[Dalila][security]` prefix and emitted as `dalila:security-error` events when the environment supports `dispatchEvent`.

Use the core helpers if you want to consume that signal directly:

```ts
import {
  SECURITY_RUNTIME_EVENT_NAME,
  getSecurityRuntimeEvents,
} from 'dalila/core';

window.addEventListener(SECURITY_RUNTIME_EVENT_NAME, (event) => {
  console.log('security event', (event as CustomEvent).detail);
});

console.log(getSecurityRuntimeEvents());
```

## 3. Recommended app-level tightening

The framework default is a safe baseline, not the end of the review.

For multi-tenant or high-risk apps, keep these additional controls:

- Enforce a production CSP at the edge or reverse proxy.
- Use `HttpOnly`, `Secure`, `SameSite` cookies.
- Keep CSRF protection enabled for unsafe methods.
- Add rate limiting and abuse controls on auth and mutation endpoints.
- Partition caches and authorization checks by tenant.
- Run dependency scanning and XSS regression tests in CI.

## 4. Overriding the defaults

You can still supply your own sanitizer or security profile:

```ts
import DOMPurify from 'dompurify';
import { configure } from 'dalila/runtime';

configure({
  sanitizeHtml: (html) => DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style'],
    FORBID_ATTR: ['srcdoc', 'onerror', 'onload', 'onclick'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  }),
  security: {
    strict: true,
    trustedTypes: true,
    trustedTypesPolicyName: 'my-app-html',
  },
});
```

If you intentionally trust a sink, override `sanitizeHtml` locally or globally with your own policy. Do not disable the default without documenting why the input is trusted.

If you need to turn off Dalila's automatic default sanitizer for a scope and go back to explicit-only sanitization, set `useDefaultSanitizeHtml: false` and provide your own `sanitizeHtml` policy when needed.

## 5. Default threat model for common Dalila apps

Use this as the baseline threat model for a standard SSR/SPA web app with forms, auth, and some user-generated content.

### Assets

- session cookies or auth tokens
- tenant or account-scoped data
- HTML-rich content rendered with `d-html`
- uploaded files and media URLs
- audit logs and security telemetry

### Trust boundaries

- browser <-> backend API
- backend API <-> database
- backend API <-> object storage / CDN
- internal services <-> third-party providers

### Primary threats

- Stored XSS through user-generated HTML or URLs
- Reflected XSS through unsafe template injection
- Broken tenant isolation / IDOR
- CSRF on authenticated mutations
- Sensitive data exposure through logs, caches, or shared objects
- DoS through unbounded expensive queries, uploads, or retries

### Default mitigations already in Dalila

- strict runtime sink blocking
- sanitized `d-html`
- security smoke checks in `dalila check`
- security headers in the dev server
- runtime security logging / events

### App responsibilities that remain

- backend authorization on every read/write path
- CSP/HSTS on the real production edge
- cookie/session configuration
- secrets handling
- rate limiting and abuse controls
- release-time security verification

## 6. Release checklist

- [ ] `dalila check` passes, including security smoke
- [ ] Production CSP reviewed and deployed
- [ ] Auth cookies/tokens reviewed
- [ ] Raw sinks (`d-html`, `fromHtml()`, `srcdoc`, direct HTML writes) reviewed
- [ ] Tenant isolation tests passing
- [ ] Security logs/alerts wired to your observability stack

Use with:

- `SECURITY.md`
- `docs/production.md`
- `docs/threat-model.md`
