# dalila check

Static analysis for route HTML templates plus project security smoke.

`dalila check` does two things:

1. Validates template identifiers against route context.
2. Runs a project-level security smoke scan for obvious raw HTML / XSS footguns.

Template validation uses:

- Route params from the path (e.g. `[id]` -> `id`)
- Built-ins: `params`, `query`, `path`, `fullPath`
- Keys inferred from `loader()` return type
- Known loop variables inside loop scope (`item`, `key`, `$index`, ...)

It scans:

- Text interpolations: `{expr}`
- Directive expressions: `d-*` supported by the checker (events, conditionals, list/virtual list bindings, form directives, etc.)

It ignores expressions inside raw blocks:

- `<pre>...</pre>` / `<code>...</code>`
- any subtree marked with `d-pre` / `d-raw` (attribute or `<d-pre>` / `<d-raw>` tag)

Security smoke scans project `.html`, `.ts`, and `.js` files under the selected path.

## Usage

```bash
npx dalila check
npx dalila check src/app
npx dalila check src/app --strict
```

## `--strict` behavior

By default, if a route exports `loader` but its return keys cannot be inferred, template variable diagnostics for that route template are skipped to avoid false positives.

With `--strict`, those routes fail with an explicit error, for example:

- `... exports "loader", but its return type could not be inferred`

Use strict mode in CI when you want enforceable loader/template type contracts.
`--strict` changes only the template/type-inference checks. Security smoke still runs either way.

## Security smoke

Security smoke reports:

- errors for inline `on*=` handlers and executable/dangerous URL protocols in HTML template sinks
- warnings for review-required raw sinks such as `d-html`, `srcdoc`, `d-attr-srcdoc`, `fromHtml()`, `innerHTML` / `outerHTML`, `insertAdjacentHTML()`, and `document.write()`

Warnings do not fail the command. Errors do.

## What counts as inferable loader data

The checker accepts object-like loader returns and uses their keys as valid template identifiers.

Non-object or broad/uninferable returns (for example `Promise<any>`, primitive returns, array returns) are treated as uninferable.

## Typical diagnostics

Undefined identifier:

- `"cont" is not defined in template context (interpolation)`

With suggestion:

- `"cont" is not defined in template context (interpolation). Did you mean "count"?`

## Notes

- Loop scope detection is quote-aware and supports `d-each`/`d-virtual-each` with single or double quotes.
- Interpolation scanning supports multiline expressions and template literals.
- `htmlPath` external templates are also checked.
