# Threat Model (STRIDE) - Dalila Apps

Use this template before shipping apps that handle sensitive data.

## 1. System definition

- App name:
- Owners:
- Environment: `dev` / `staging` / `prod`
- Data sensitivity: `low` / `medium` / `high`

## 2. Assets and trust boundaries

Assets:

- User session/token data
- Tenant data
- HTML-rich content
- Uploaded files
- Audit/event logs

Trust boundaries:

- Browser <-> API
- API <-> DB
- API <-> object storage
- Internal services <-> external providers

## 3. Entry points and data flows

Document critical flows:

1. Authentication
2. Tenant-scoped resource access
3. Rich text render path (`d-html`)
4. File upload/download
5. Admin workflows

## 4. STRIDE analysis

For each critical flow, record threats:

1. `S`poofing
2. `T`ampering
3. `R`epudiation
4. `I`nformation disclosure
5. `D`enial of service
6. `E`levation of privilege

Template:

| Flow | STRIDE | Threat | Mitigation | Owner | Status |
|---|---|---|---|---|---|
| Rich text render | T / I / E | Stored XSS via tenant content | `sanitizeHtml` + CSP + sink review | Frontend | Open |

## 5. Risk scoring

For each threat:

- Likelihood: `1-5`
- Impact: `1-5`
- Score: `Likelihood x Impact`
- Severity: `Low (1-5)`, `Medium (6-12)`, `High (15-25)`

Release policy:

- No unresolved `High` risks.
- `Medium` risks need approved mitigation plan and due date.

## 6. Verification checklist

- [ ] Dalila secure runtime profile enabled
- [ ] Default/custom sanitizer policy reviewed (`d-html`, `fromHtml()`, `srcdoc`)
- [ ] CSP enforced in production
- [ ] Tenant isolation tests passing
- [ ] XSS/CSRF tests passing
- [ ] Logging/alerting enabled for security signals
- [ ] Rollback procedure tested

## 7. Sign-off

- Security owner:
- Engineering owner:
- Product owner:
- Date:
- Release decision: `Go` / `No-Go`
