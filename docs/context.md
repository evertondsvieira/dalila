# Context (Dependency Injection)

Dalila Context is **scope-based dependency injection**.

A context value is stored in the **current Scope** and is visible to:
- the current scope
- **all child scopes** created under it

This makes DI lifecycle-safe: when a scope is disposed, any registry owned by that scope
is released.

Dalila provides two entry points:

- `dalila/context` (**auto-scope**) -> recommended for application code
- `dalila/context/raw` (**strict**) -> recommended for library code or when you want
  **zero implicit global state**

---

## Start here (the minimal mental model)

You only need four pieces to get started:

1) `createContext()` creates a token
2) `scope()` creates a lifecycle boundary
3) `provide()` stores a value in the current scope
4) `inject()` reads from the current scope or any parent scope

```ts
import { createContext, scope, provide, inject } from "dalila/context";

const Theme = createContext<string>("theme");

const { dispose } = scope(() => {
  provide(Theme, "dark");
  console.log(inject(Theme)); // "dark"
});

dispose();
```

---

## Semantics (read in order)

- **Token identity**: lookup uses the token instance, not the name
- **Provide**: stores a value in the current scope
- **Inject**: walks up parent scopes until it finds the token
- **Visibility**: parents are visible to children; siblings are isolated
- **Lifecycle**: disposing a scope drops its context values

---

## Default values

You can provide a default at token creation time. If nothing is provided, `inject()`
returns the default instead of throwing.

```ts
import { createContext, scope, inject } from "dalila/context";

const Locale = createContext<string>("locale", "en-US");

scope(() => {
  console.log(inject(Locale)); // "en-US" (no provider needed)
});
```

---

## tryInject (optional dependencies)

`tryInject()` avoids exceptions and tells you whether the token exists.
It also distinguishes "not found" from "found with undefined".

```ts
import { createContext, scope, provide, tryInject } from "dalila/context";

const OptionalFeature = createContext<string | undefined>("optional");

scope(() => {
  provide(OptionalFeature, undefined);

  const result = tryInject(OptionalFeature);
  if (result.found) {
    console.log("Found:", result.value); // undefined, but found
  } else {
    console.log("Not provided at all");
  }
});
```

---

## Reactive shared state (recommended upgrade)

If the value should be reactive, prefer `createSignalContext()`.
It creates a context whose value is a `signal`, with helpers to provide/inject it.

```ts
import { createSignalContext, scope } from "dalila/context";
import { effect } from "dalila";

const Theme = createSignalContext("theme", "light");

scope(() => {
  const theme = Theme.provide(); // signal

  effect(() => {
    document.body.className = theme();
  });

  theme.set("dark");
});

scope(() => {
  const theme = Theme.inject();
  console.log(theme()); // "dark"
});
```

---

## Auto-scope behavior (global, explicit)

Auto-scope is designed for application code to avoid manual scope wiring everywhere.

**Rules:**
- `provide()` outside a scope **throws** by default (configurable via `setAutoScopePolicy`).
- The global root is a real `Scope` and can be disposed.
- `inject()` outside a scope **never creates** global state; it only reads an existing global root.

```ts
import { createContext, provideGlobal, injectGlobal } from "dalila/context";

const Theme = createContext<string>("theme");

provideGlobal(Theme, "dark");
console.log(injectGlobal(Theme)); // "dark"
```

---

## Raw API (strict)

Raw context is strict and explicit:
- `provide()` must be called **inside a scope**
- `inject()` must be called **inside a scope**
- no global scope is ever created

```ts
import { createContext, provide, inject } from "dalila/context/raw";
import { createScope, withScope } from "dalila/core";

const Theme = createContext<string>("theme");
const appScope = createScope();

withScope(appScope, () => {
  provide(Theme, "dark");
  console.log(inject(Theme));
});
```

---

## Common pitfalls

### 1) Providing in a sibling scope

This will not work because siblings don't inherit from each other.

```ts
import { createContext, scope, provide, inject } from "dalila/context";

const Theme = createContext<string>("theme");

const a = scope(() => {
  provide(Theme, "dark");
});

scope(() => {
  inject(Theme); // throws: not found (different scope tree)
});

a.dispose();
```

**Fix:** provide in an ancestor scope shared by both.

### 2) Injecting after the provider scope is disposed

If the scope that provided the context is disposed, the context disappears.

**Fix:** keep the provider scope alive for as long as consumers need it, or provide higher
in the scope tree.

### 3) Forgetting to use signals for reactive values

```ts
// WRONG: value is captured at provide() time
const count = signal(0);
provide(CountContext, count()); // Provides 0, not reactive

// CORRECT: provide the signal itself
provide(CountContext, count); // Consumers can call count() reactively
```

---

## Context in async operations

When using context inside queries/resources, the context is available during the **synchronous
phase** before the first `await`:

```ts
import { scope, provide, inject, createContext } from "dalila";
import { createQueryClient } from "dalila";

const ApiToken = createContext<string>("api-token");
const q = createQueryClient();

scope(() => {
  provide(ApiToken, "secret-123");

  const userQuery = q.query({
    key: () => ["user", "me"],
    fetch: async (signal) => {
      // Context available here (before await)
      const token = inject(ApiToken);

      const res = await fetch("/api/me", {
        signal,
        headers: { Authorization: `Bearer ${token}` },
      });

      // Context NOT available after await (different execution context)
      return res.json();
    },
  });
});
```

**Tip:** capture context values in variables before any `await`.

---

## Configuration

### Auto-scope policy

```ts
import { setAutoScopePolicy } from "dalila";

setAutoScopePolicy("throw");  // Default: throws if provide() outside scope
setAutoScopePolicy("warn");   // Warns and creates global scope
setAutoScopePolicy("silent"); // No warning, creates global scope silently
```

### Deep hierarchy warning

By default, Dalila warns when context lookup traverses more than 50 parent scopes:

```ts
import { setDeepHierarchyWarnDepth } from "dalila";

setDeepHierarchyWarnDepth(100);      // Warn at 100 levels
setDeepHierarchyWarnDepth(Infinity); // Disable warning
```

---

## createProvider helper

Use `createProvider()` when you want to:
- bundle multiple related context values behind one provider boundary
- expose a single, composable provider API for higher-level features
- control setup/teardown in one place instead of scattering `provide()` calls

```ts
import { createContext, createProvider } from "dalila";

interface AuthService {
  user: () => User | null;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthService>("auth");

export const AuthProvider = createProvider(AuthContext, () => {
  const user = signal<User | null>(null);

  return {
    user,
    login: async (creds) => { /* ... */ },
    logout: () => user.set(null),
  };
});

// Usage
const { value: auth, dispose } = AuthProvider.create();
// Later...
const auth = AuthProvider.use(); // Same as inject(AuthContext)
```

---

## Debug helpers

Use these helpers during development to inspect availability and resolution:

```ts
import { listAvailableContexts, injectMeta } from "dalila";

// List all contexts in the current scope hierarchy
const contexts = listAvailableContexts();
// [{ depth: 0, tokens: [{ name: "theme", token }] }, ...]

// Get detailed injection info
const meta = injectMeta(Theme);
// { value: "dark", ownerScope: Scope, depth: 2 }
```

---

## Testing

For test isolation, reset the global scope between tests:

```ts
import { resetGlobalScope } from "dalila";

afterEach(() => {
  resetGlobalScope();
});
```

Or use explicit scopes for each test:

```ts
import { createScope, withScope } from "dalila/core";
import { provide, inject } from "dalila/context/raw";

test("my test", () => {
  const testScope = createScope();

  withScope(testScope, () => {
    provide(MyContext, mockValue);
    // ... test code
  });

  testScope.dispose();
});
```

---

## Multiple Dalila instances

Sometimes the same app ends up with **two copies of the Dalila runtime** in the bundle
by accident. That can happen when:
- a library bundles Dalila inside itself, and your app also uses Dalila directly
- two dependencies pull different Dalila versions

If each copy kept its own global scope, `provideGlobal()` from one copy would not be
visible to `injectGlobal()` from the other copy. To avoid that split, Dalila stores the
global scope under a shared symbol: `Symbol.for('dalila:global-scope')`. The `Symbol.for`
registry is global, so both copies resolve the **same** key and share the same global scope.

If you want **isolation** on purpose, skip the global scope and use `createScope()`
explicitly for your own scope trees.
