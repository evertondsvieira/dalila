# Changelog

All notable changes to Dalila will be documented in this file.

The format is based on Keep a Changelog, with project-oriented sections:

- `Added`
- `Changed`
- `Fixed`
- `Security`
- `Breaking`

## [Unreleased]

### Added

- `sanitizeHtml` runtime option (`configure()` + per-`bind()` override) for `d-html`
- Default runtime security baseline (`security.strict` + default `sanitizeHtml`) for stricter HTML/attribute handling
- Security/release readiness documentation
- CI workflow with Node matrix + Playwright browser matrix
- Example smoke E2E tests

### Changed

- Dev-mode warnings for raw HTML sinks now clarify they are heuristic only
- Playwright config runs multi-browser matrix in CI

### Fixed

- Form path parser prototype pollution vectors (`__proto__`, `constructor`, `prototype`)
- XSRF header leakage to cross-origin requests
- Inline preload script breakout (`</script>`) handling
- Dev server malformed URL decode crash (`decodeURIComponent`)

### Security

- Added guardrails for `d-attr-*` dangerous cases (`d-attr-on*`, `javascript:` URLs)
- Added security docs (`SECURITY.md`, trust-boundary documentation)

### Breaking

- `d-attr-on*` inline event-handler attributes are now blocked (use `d-on-*`)

## [1.9.23] - 2026-03-03

### Added

- Internal hardening/test coverage for forms, http, persist, dev server and runtime sinks

### Security

- Multiple security fixes and guardrails landed as part of the security hardening sprints
