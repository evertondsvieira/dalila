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
- Scaffold smoke coverage for generated `create-dalila` apps, including standalone multi-page `dist/` output
- Bundle guardrails for published package contents and generated starter output
- Raw subtree support with `d-pre` / `d-raw` (attribute and tag forms) that renders nested markup as inert text during `bind()`

### Changed

- Dev-mode warnings for raw HTML sinks now clarify they are heuristic only
- Playwright config runs multi-browser matrix in CI
- `create-dalila` starter now builds an optimized standalone previewable `dist/` output instead of TypeScript-only emit
- Dev tooling now resolves source roots from `tsconfig` for import-map injection, `@/` aliases, and preload detection
- UI docs and starter guidance now use the published `dalila/components/ui` entry points
- Added granular `dalila/core/*` and `dalila/runtime/*` exports for bundle-sensitive imports
- `dalila check` now ignores interpolation/directive parsing inside raw blocks (`d-pre`/`d-raw`) while keeping directive validation aligned with runtime behavior

### Fixed

- Form path parser prototype pollution vectors (`__proto__`, `constructor`, `prototype`)
- XSRF header leakage to cross-origin requests
- Inline preload script breakout (`</script>`) handling
- Dev server malformed URL decode crash (`decodeURIComponent`)
- Standalone starter packaging for import maps, additional HTML entry points, nested `outDir`, inferred `rootDir`, raw assets, and `/src/*` source rewrites
- Standalone starter packaging now trims vendor/app modules to the reachable graph and avoids dragging wide internal core barrels through runtime leaf imports
- Dev server HMR watching for user projects, including top-level asset folders and recreated directories
- Firefox UI component E2E timeout caused by waiting on stylesheet-heavy fixture loads

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
