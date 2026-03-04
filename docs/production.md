# Production Guide

This guide covers practical steps to run Dalila safely and reliably in production applications.

## 1. Build and test before deploy

Minimum recommended pipeline:

```bash
npm run build
npm run test:typecheck
npm run test:unit
npm run test:e2e
```

## 2. Security checklist (app-level)

Dalila provides guardrails, but application code still defines trust boundaries.

- Prefer `{token}` / `d-text` for untrusted content
- `d-html` is sanitized by default; configure `sanitizeHtml` for stricter policy control
- Treat `fromHtml()` input as trusted template markup
- Validate URLs before binding to `href`, `src`, `formaction`
- Use cookie auth + XSRF protection correctly (`docs/http.md`)

Recommended runtime baseline:

```ts
import DOMPurify from 'dompurify';
import { configure } from 'dalila/runtime';

configure({
  sanitizeHtml: (html) => DOMPurify.sanitize(html),
  security: { strict: true },
});
```

## 3. Error handling

- Use `createErrorBoundary` / `d-boundary` around risky UI regions
- Log errors with `onError`
- Do not expose raw stack traces to end users

## 4. Performance checklist

- Use `d-virtual-each` for large lists
- Avoid unnecessary `d-html` for plain text
- Keep binding contexts flat and explicit
- Dispose bindings on teardown/unmount

## 5. Observability

Recommended signals to monitor in real apps:

- client-side exceptions
- route navigation failures
- failed HTTP requests / timeout rates
- UI latency hotspots (large lists, repeated mounts)

## 6. Deployment notes

- Dalila dev server is for local development only
- The `create-dalila` starter writes an optimized self-contained `dist/` directory (`npm run build`) that can be served directly
- For production, serve built assets with your standard web server / CDN
- Ensure CSP and security headers are configured at the app/server level
- Follow `docs/security-hardening.md` for multi-tenant/high-risk deployments
- Complete `docs/threat-model.md` for release sign-off in regulated environments

## 7. Release readiness for app teams

Before shipping a Dalila app:

- [ ] security review completed for raw HTML and URL sinks
- [ ] threat model completed and approved (when app handles sensitive data)
- [ ] smoke tests for critical routes
- [ ] error boundary coverage for risky pages
- [ ] observability/logging enabled
