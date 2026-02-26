# Scopes Guide

Scopes are the foundation of lifecycle management in Dalila.

## What Is a Scope

- cleanup container
- organizes parent/child hierarchy
- several APIs (`effect`, resources, watchers) register automatically when created inside a scope

## When to Create a Scope Manually

Use `createScope()` + `withScope()` when you need explicit lifecycle control:

- app bootstrap without `bind()`
- widgets/libraries with imperative mount/unmount
- group effects/listeners/resources for shared disposal

```ts
const scope = createScope();

withScope(scope, () => {
  effect(() => console.log(count()));
});

// later
scope.dispose();
```

## When You Usually Don't Need It

- tree managed by `bind()` (the runtime already handles cleanup)
- typical `dalila/context` usage with auto-scope

## `dalila/context` vs `dalila/context/raw`

### `dalila/context`

For app code. Includes auto-scope and helpers like `scope(() => ...)`.

### `dalila/context/raw`

For libs/internals that want strict and explicit scope rules.

## Useful Patterns

### Feature scope

```ts
const featureScope = createScope();
withScope(featureScope, setupFeature);
```

### Temporary Scope via Helper

```ts
const { result, dispose } = scope(() => setupDialog());
```

### Explicit Cleanup

```ts
withScope(createScope(), () => {
  const stop = effect(() => console.log(state()));
  onCleanup(stop);
});
```
