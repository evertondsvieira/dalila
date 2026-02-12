# dalila check

Static analysis for route HTML templates.

`dalila check` validates template identifiers against route context:

- Route params from the path (e.g. `[id]` -> `id`)
- Built-ins: `params`, `query`, `path`, `fullPath`
- Keys inferred from `loader()` return type
- Known loop variables inside loop scope (`item`, `key`, `$index`, ...)

It scans:

- Text interpolations: `{expr}`
- Directive expressions: `d-*` supported by the checker (events, conditionals, list/virtual list bindings, form directives, etc.)

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
