# Dev Mode

Dev mode toggles extra warnings and debug behavior across the runtime.

## Core Concepts

- Dev mode is purely for diagnostics.
- It enables warnings for unsafe or suspicious usage patterns.

## API Reference

```ts
function setDevMode(enabled: boolean): void
function isInDevMode(): boolean
function setDevtoolsEnabled(enabled: boolean, options?): void
function isDevtoolsEnabled(): boolean
function configureDevtools(options): void
function getDevtoolsSnapshot(): DevtoolsSnapshot
function onDevtoolsEvent(listener): () => void
function resetDevtools(): void
function initDevTools(options?): Promise<void>
```

## Example

```ts
import { setDevMode } from "dalila";

setDevMode(true);
```

```ts
import { initDevTools, getDevtoolsSnapshot } from "dalila";

await initDevTools();
const snapshot = getDevtoolsSnapshot();
console.log(snapshot.nodes, snapshot.edges);
```

## Devtools Bridge

When enabled, Dalila exposes a runtime bridge for browser tooling:

- Global hook: `globalThis.__DALILA_DEVTOOLS__`
- Browser event stream: `dalila:devtools:event`
- Snapshot includes:
  - Nodes (`scope`, `signal`, `computed`, `effect`, `effectAsync`)
  - Dependency edges (reactive graph)
  - Ownership edges (scope hierarchy / ownership)

## Devtools Panel Glossary

This section explains every label you see in the Devtools extension panel.

### Cards

- `Nodes`: total number of registered runtime nodes (includes active and disposed nodes).
- `Edges`: total number of graph edges in snapshot (`dependency` + `ownership`).
- `Scopes`: number of `scope` nodes.
- `Signals`: number of `signal` and `computed` nodes combined.
- `Effects`: number of `effect` and `effectAsync` nodes combined.
- `Events`: number of recent runtime events currently buffered.

### Node Types

- `scope`: lifecycle container. Owns signals/effects/resources created inside it.
- `signal`: mutable reactive value.
- `computed`: derived reactive value; recalculated from dependencies.
- `effect`: synchronous side-effect that re-runs when dependencies change.
- `effectAsync`: async side-effect variant tracked separately.

### Node Row State

- `active`: node is still alive and can keep participating in reactivity.
- `disposed`: node was cleaned up by scope disposal or explicit teardown.

### Node Counters

- `reads`: how many times that node value was read.
- `writes`: how many times that node value was written (mostly relevant for `signal`/`computed`).
- `runs`: how many times an effect/computed execution cycle ran.

### Edges

- `dependency`: reactive subscription edge. Usually `signal/computed -> effect/computed`.
- `ownership`: lifecycle ownership edge. Usually `scope -> child scope/signal/computed/effect`.

In the panel center list (`Dependencies`), only dependency edges are shown. Ownership edges are still present in the snapshot and in the total `Edges` card.

### Panel Controls

- `Enable Bridge` / `Disable Bridge`:
  - Turns runtime devtools instrumentation on/off via the global hook.
  - Requires your app to call `await initDevTools()` at startup.
- `Refresh`: fetches one new snapshot immediately.
- `Live`: enables periodic auto-refresh (polling).
- `Highlight updates`: highlights recently changed effect nodes in the inspected page DOM.

### Status Messages

- `missing_hook`: the extension could not find `globalThis.__DALILA_DEVTOOLS__` in inspected page. Usually means `initDevTools()` was not called yet.
- `invalid_hook`: hook exists but does not expose the expected API.
- `get_snapshot_failed`: hook exists but snapshot read threw an error.

### Event Buffer

- The event list is capped (`maxEvents`, default `500`).
- You can configure this through `initDevTools({ maxEvents })` or `configureDevtools({ maxEvents })`.

## Browser Extension

Use the DevTools panel extension in this repository for visual inspection:

- `devtools-extension/README.md`

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
