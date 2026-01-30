# Dev Mode

Dev mode toggles extra warnings and debug behavior across the runtime.

## Core Concepts

- Dev mode is purely for diagnostics.
- It enables warnings for unsafe or suspicious usage patterns.

## API Reference

```ts
function setDevMode(enabled: boolean): void
function isInDevMode(): boolean
```

## Example

```ts
import { setDevMode } from "dalila";

setDevMode(true);
```

## Comparison: Dev Mode On vs Off

| Mode | Pros | Cons |
|------|------|------|
| On | Warnings, easier debugging | Extra checks, more console noise |
| Off | Faster, quieter | Less guidance for mistakes |

## What It Affects

- Context warnings (missing providers, deep hierarchy)
- List warnings (duplicate keys, unscoped usage)
- Resource cache warnings (persist without TTL, cache outside scope)
- General runtime warnings where applicable

## Best Practices

- Enable in local development.
- Disable in production builds.

## Common Pitfalls

- Leaving dev mode on in production can add noise and overhead.

## Performance Notes

- Warnings add console overhead and extra checks.
- Disable for production performance.
