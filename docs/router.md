# Router

Client-side routing with nested layouts, parallel data loading, intelligent preloading, and file-based route generation.

## Core Concepts

```
┌──────────────────────────────────────────────────────────────┐
│                    Navigation Pipeline                       │
│                                                              │
│  URL change → middleware → guard → validate → load → render  │
│                                                              │
│  Route stack: RootLayout > DashboardLayout > AnalyticsPage   │
│  Data loading: all loaders run in parallel via Promise.all   │
└──────────────────────────────────────────────────────────────┘
```

**Key ideas:**
1. **Pre-compiled route tree** — regex and sort computed once at init, zero-cost matching
2. **Route stack composition** — nested layouts wrap children automatically
3. **Parallel data loading** — validation runs sequentially (fail-fast), loaders run concurrently
4. **Declarative links** — `d-link` attribute with params, query, hash, and prefetch

## API Reference

### createRouter

```ts
import { createRouter } from 'dalila/router';

function createRouter(config: RouterConfig): Router
```

### Router

```ts
interface Router {
  start(): void;
  stop(): void;
  navigate(path: string, options?: NavigateOptions): Promise<void>;
  push(path: string): Promise<void>;
  replace(path: string): Promise<void>;
  back(): void;
  preload(path: string): void;
  invalidateByTag(tag: string): void;
  invalidateWhere(predicate: (entry: RouterPreloadCacheEntry) => boolean): void;
  prefetchByTag(tag: string): Promise<void>;
  prefetchByScore(minScore: number): Promise<void>;
  route: Signal<RouteState>;
  status: Signal<RouterStatus>;
}
```

### RouterConfig

```ts
interface RouterConfig {
  routes: RouteTable[];
  outlet: Element;
  routeManifest?: RouteManifestEntry[];  // from file-based generator
  basePath?: string;
  scrollBehavior?: 'auto' | 'smooth' | 'none';  // default: 'auto'
  preloadCacheSize?: number;       // default: 50
  scrollPositionsCacheSize?: number;  // default: 100
  globalMiddleware?: RouteMiddlewareResolver;
  hooks?: LifecycleHooks;
  pendingView?: (ctx: RouteCtx) => Node | DocumentFragment | Node[];
  errorView?: (ctx: RouteCtx, error: unknown) => Node | DocumentFragment | Node[];
  notFoundView?: (ctx: RouteCtx) => Node | DocumentFragment | Node[];
}
```

### RouteTable

```ts
interface RouteTable {
  path: string;
  view?: (ctx: RouteCtx, data: any) => Node | DocumentFragment | Node[];
  layout?: (ctx: RouteCtx, child: Node | DocumentFragment | Node[], data: any) => Node | DocumentFragment | Node[];
  loader?: (ctx: RouteCtx) => Promise<any>;
  preload?: (ctx: RouteCtx) => Promise<any>;
  pending?: (ctx: RouteCtx) => Node | DocumentFragment | Node[];
  error?: (ctx: RouteCtx, error: unknown) => Node | DocumentFragment | Node[];
  notFound?: (ctx: RouteCtx) => Node | DocumentFragment | Node[];
  children?: RouteTable[];
  middleware?: RouteMiddleware[] | RouteMiddlewareResolver;
  guard?: (ctx: RouteCtx) => boolean | string | null | Promise<...>;
  redirect?: string | ((ctx: RouteCtx) => string | null | Promise<string | null>);
  validation?: RouteValidationConfig | (() => RouteValidationConfig | null | Promise<...>);
  tags?: string[];
  score?: number;
}
```

### RouteCtx

```ts
interface RouteCtx {
  path: string;                                    // /posts/123
  fullPath: string;                                // /posts/123?tab=comments#top
  params: Record<string, string | string[]>;       // catch-all returns string[]
  query: URLSearchParams;
  hash: string;                                    // without #
  signal: AbortSignal;
  scope: Scope;
  navigate: (to: string, options?: NavigateOptions) => Promise<void>;
}
```

### RouterStatus

```ts
type RouterStatus =
  | { state: 'idle' }
  | { state: 'loading'; to: RouteState }
  | { state: 'error'; to: RouteState; error: unknown };
```

## Basic Usage

```ts
import { createRouter } from 'dalila/router';

const router = createRouter({
  outlet: document.getElementById('app')!,
  routes: [
    { path: '/', view: () => html`<h1>Home</h1>` },
    { path: '/about', view: () => html`<h1>About</h1>` }
  ]
});

router.start();
```

## Routes

### Dynamic Parameters

```ts
{ path: '/users/:id', view: (ctx) => html`<p>User ${ctx.params.id}</p>` }
```

### Catch-all Params

```ts
{ path: '/docs/:slug*', view: (ctx) => renderDocs(ctx.params.slug) }   // string[], requires 1+
{ path: '/docs/:slug*?', view: (ctx) => renderDocs(ctx.params.slug) }  // string[], matches /docs too
```

### Nested Routes

```ts
{
  path: '/dashboard',
  layout: (ctx, children) => html`<div class="dash">${children}</div>`,
  children: [
    { path: '', view: () => html`<p>Overview</p>` },
    { path: 'settings', view: () => html`<p>Settings</p>` }
  ]
}
```

Layouts wrap children automatically. For `/dashboard/settings` the result is:

```
RootLayout > DashboardLayout > SettingsPage
```

### Redirects

```ts
{ path: '/old', redirect: '/new' }                               // static
{ path: '/users/:id', redirect: (ctx) => `/profile/${ctx.params.id}` }  // dynamic
{ path: '/protected', redirect: async () => (await checkAuth()) ? null : '/login' }  // async
```

- Redirects use `replaceState` to keep URL/history synchronized
- Parent redirects are evaluated before child redirects (first match wins)

### Guards

```ts
{
  path: '/admin',
  guard: async (ctx) => {
    const isAuth = await checkAuth();
    return isAuth ? true : '/login';  // true | false | '/redirect'
  },
  view: createAdminView
}
```

### Middleware

Per-route middleware runs before guards:

```ts
{ path: '/admin', middleware: [auditMiddleware, authMiddleware], view: createAdminView }
```

Global middleware runs before all route middleware:

```ts
createRouter({ outlet: app, routes, globalMiddleware: [analyticsMiddleware] });
```

### Validation

Validates params/query before loaders execute (router built-in rule format):

```ts
{
  path: '/users/:id',
  validation: {
    params: { id: ['required', 'min:1'] },
    query: { tab: [{ rule: 'pattern', value: '^(overview|activity)$' }] }
  },
  loader: async (ctx) => fetchUser(ctx.params.id),
  view: (ctx, data) => createUserView(data)
}
```

## Data Loading

### Loader and Preload

```ts
{
  path: '/posts/:id',
  loader: async (ctx) => {
    const res = await fetch(`/api/posts/${ctx.params.id}`);
    return res.json();
  },
  view: (ctx, post) => html`<article>${post.title}</article>`
}
```

`preload` works like `loader` but is used only for preloading. If no `loader` exists, the `preload` result is used during navigation.

### Parallel Loading

Nested loaders run concurrently. Validation still runs sequentially (fail-fast):

```ts
{
  path: '/dashboard',
  loader: async () => fetchStats(),        // starts immediately
  children: [{
    path: 'analytics',
    loader: async () => fetchAnalytics(),  // starts in parallel
    view: (ctx, data) => createAnalyticsView(data)
  }]
}
```

## State Views

```ts
{
  path: '/posts/:id',
  pending: () => html`<div class="spinner"></div>`,
  error: (ctx, err) => html`<p>Failed: ${err.message}</p>`,
  loader: async (ctx) => fetchPost(ctx.params.id),
  view: (ctx, post) => createPostView(post)
}
```

Global defaults via `pendingView`, `errorView`, `notFoundView` in `RouterConfig`.

## Lifecycle Hooks

```ts
createRouter({
  outlet: app,
  routes,
  hooks: {
    beforeNavigate: async (to, from) => {
      // return false to cancel, or navigate elsewhere
      return true;
    },
    afterNavigate: (to, from) => {
      trackPageView(to.path);
    },
    onError: (error, ctx) => {
      showErrorToast(error);
    }
  }
});
```

If `afterNavigate` throws, the error is caught and routed to `onError`.

## Declarative Links

```html
<a d-link="/about">About</a>
<a d-link="/users/:id" d-params='{"id":"123"}'>User 123</a>
<a d-link="/search" d-query='{"q":"dalila"}' d-hash="results">Search</a>
```

The router intercepts left-clicks without modifiers on same-tab, non-download `d-link` anchors.

### Boolean d-link

```html
<a href="/about" d-link>About</a>
<a href="/search?sort=asc" d-link d-query='{"page":"2"}'>Next</a>
```

Falls back to `href` when `d-link` has no value. External URLs and non-http protocols are not intercepted. `d-query` merges with existing query params; `d-hash` overrides existing hash.

### d-prefetch

```html
<a d-link="/billing" d-prefetch="hover">Billing</a>     <!-- default -->
<a d-link="/dashboard" d-prefetch="focus">Dashboard</a>
<a d-link="/users" d-prefetch="off">Users</a>
```

## Preloading and Prefetching

```ts
router.preload('/posts/123');          // fire-and-forget
await router.prefetchByTag('critical'); // await completion
await router.prefetchByScore(700);     // routes with score >= 700
router.invalidateByTag('users');       // evict cache entries
router.invalidateWhere((e) => e.routePath === '/users/:id' && e.params.id === '42');
```

The preload cache awaits pending operations — `prefetchByTag`/`prefetchByScore` only resolve after all preload work completes.

## Router Status

```ts
import { effect } from 'dalila';

effect(() => {
  const s = router.status();
  if (s.state === 'loading') showLoadingBar();
  else hideLoadingBar();
});
```

## Reactive Route State

```ts
effect(() => {
  const route = router.route();
  console.log('Current path:', route.path);
});
```

## Navigation Coalescing

Simultaneous calls to the same URL + history mode are coalesced into a single transition. Two calls with different modes (`push` vs `replace`) execute independently.

## Type-Safe Navigation

For projects using the file-based route generator:

```ts
import { createTypedNavigate } from 'dalila/router';
import { buildRoutePath } from './routes.generated.types';
import type { RoutePattern, RouteParamsByPattern } from './routes.generated.types';

const navigateTo = createTypedNavigate<RoutePattern, RouteParamsByPattern>(router, buildRoutePath);

navigateTo('/users/:id', { id: '123' });         // compile-time checked
navigateTo('/dashboard', {}, { replace: true });
```

## File-Based Routing

The Dalila CLI generates route tables, manifests, and type definitions from your file structure.

### Setup

```bash
dalila routes init                  # scaffold src/app with starter files
dalila routes generate              # generate route files
dalila routes watch                 # regenerate on file changes
dalila routes generate --output src/routes.generated.ts
```

### File Structure

```
src/app/
├── layout.html          # root layout
├── page.html            # / (home)
├── page.ts              # loader/guard/redirect for /
├── about/
│   └── page.html        # /about
├── blog/
│   ├── layout.html      # shared blog layout
│   ├── page.html        # /blog
│   ├── [slug]/
│   │   ├── page.html    # /blog/:slug
│   │   └── page.ts      # loader for /blog/:slug
│   └── [[...tags]]/
│       └── page.html    # /blog/:tags*? (optional catch-all)
├── dashboard/
│   ├── layout.html      # dashboard layout (sidebar, etc.)
│   ├── page.html        # /dashboard
│   ├── settings/
│   │   └── page.html    # /dashboard/settings
│   └── middleware.ts     # auth middleware for /dashboard/*
└── users/
    └── [id]/
        ├── page.html    # /users/:id
        ├── page.ts      # loader
        ├── error.html   # error boundary
        ├── loading.html # pending view
        └── not-found.html  # 404 boundary
```

### Convention Files

| File | Purpose |
|------|---------|
| `page.html` | Route view template |
| `page.ts` | Route logic: `loader`, `guard`, `redirect`, `preload`, `tags`, `score`, `validation` |
| `layout.html` | Layout template (wraps children via `data-slot="children"`) |
| `layout.ts` | Layout logic: `guard`, `redirect`, `middleware`, `tags` |
| `middleware.ts` | Route middleware (exports `middleware` array) |
| `error.html` | Error boundary view |
| `loading.html` | Pending/loading view |
| `not-found.html` | Not-found boundary view |

### Dynamic Segments

| Folder name | Route pattern | Example URL |
|-------------|---------------|-------------|
| `[id]` | `:id` | `/users/123` |
| `[...slug]` | `:slug*` | `/docs/guide/intro` (1+ segments) |
| `[[...slug]]` | `:slug*?` | `/docs` or `/docs/guide/intro` |

### page.ts Exports

```ts
// src/app/users/[id]/page.ts
export const tags = ['users'];
export const score = 500;

export async function loader(ctx) {
  const res = await fetch(`/api/users/${ctx.params.id}`);
  return res.json();
}

export function guard(ctx) {
  return isAuthenticated() ? true : '/login';
}

export const validation = {
  params: { id: ['required', 'min:1'] }
};
```

### Generated Outputs

Running `dalila routes generate` produces three files:

| File | Contents |
|------|----------|
| `routes.generated.ts` | Route table array with imports and `fromHtml` templates |
| `routes.generated.manifest.ts` | Route manifest with IDs, patterns, scores, tags, and lazy `load()` |
| `routes.generated.types.ts` | `RoutePattern`, `RouteParamsByPattern`, `buildRoutePath` for type-safe navigation |

### Using Generated Routes

```ts
import { createRouter } from 'dalila/router';
import { routeTable } from './routes.generated';
import { routeManifest } from './routes.generated.manifest';

const router = createRouter({
  outlet: document.getElementById('app')!,
  routes: routeTable,
  routeManifest
});

router.start();
```

## Best Practices

1. Use `d-link` for all internal links
2. Use `ctx.signal` to cancel async operations on navigation
3. Use `d-prefetch="off"` for low-priority links
4. Configure `preloadCacheSize` for memory-constrained apps
5. Use `createTypedNavigate` for compile-time route safety
6. Maximum of 10 consecutive redirects before the router stops
