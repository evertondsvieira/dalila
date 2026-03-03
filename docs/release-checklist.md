# Release Checklist

Use this checklist before publishing a `beta`, `rc`, or `stable` release.

## 1. Scope and versioning

- [ ] Version selected (`beta` / `rc` / `stable`)
- [ ] SemVer impact reviewed (`patch` / `minor` / `major`)
- [ ] Breaking changes identified and documented
- [ ] Changelog updated (`CHANGELOG.md`)

## 2. Quality gates

- [ ] `npm run build`
- [ ] `npm run test:typecheck`
- [ ] `npm run test:unit`
- [ ] `npm run test:e2e` (or CI equivalent)
- [ ] `npm run test:smoke:examples`
- [ ] CI green on Node/browser matrix

## 3. Security checks

- [ ] Security-sensitive changes reviewed (HTML sinks, URLs, auth, storage)
- [ ] `docs/threat-model.md` completed for this release scope (required for high-risk/multi-tenant changes)
- [ ] Private reporting instructions in `SECURITY.md` still work
- [ ] `docs/security-hardening.md` controls verified for production profile
- [ ] Security fixes listed in changelog/release notes

## 4. Docs / DX

- [ ] Docs updated for API changes
- [ ] Upgrade notes added (if behavior changed)
- [ ] Examples/templates still work

## 5. Publish

- [ ] Tag/version created
- [ ] Package published
- [ ] Release notes published
- [ ] Post-release smoke verification complete
