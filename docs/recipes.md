# Recipes

Production-oriented usage patterns for Dalila.

## 1. Cookie auth + XSRF (same-origin)

```ts
import { createHttpClient } from 'dalila/http';

export const http = createHttpClient({
  baseURL: '/api',
  xsrf: true,
  onError: async (error) => {
    if (error.status === 401) {
      // redirect/login flow
      window.location.href = '/login';
    }
    throw error;
  },
});
```

Notes:
- XSRF header is attached only for same-origin unsafe requests.
- If an interceptor rewrites the request to another origin, Dalila omits the XSRF header.

## 2. Safe rich text rendering (`d-html` + sanitizer)

```ts
import DOMPurify from 'dompurify';
import { bind } from 'dalila/runtime';

bind(document.getElementById('app')!, {
  articleHtml: () => fetchState.articleHtml() ?? '',
}, {
  sanitizeHtml: (html) => DOMPurify.sanitize(html),
  security: { strict: true },
});
```

```html
<article d-html="articleHtml"></article>
```

## 3. Form parsing with nested fields

```html
<form id="profile-form">
  <input name="user.name" />
  <input name="phones[0].number" />
</form>
```

```ts
import { parseFormData } from 'dalila/form';

const form = document.getElementById('profile-form') as HTMLFormElement;
const data = parseFormData(form, new FormData(form));
```

Notes:
- Unsafe path segments (`__proto__`, `constructor`, `prototype`) are blocked.

## 4. Error boundary around risky widgets

```ts
import { createErrorBoundary } from 'dalila/runtime';

const ErrorBoundary = createErrorBoundary({
  fallback: '<div><p data-error-message></p><button d-on-click="reset">Retry</button></div>',
  onError: (err) => console.error('Widget failed', err),
});
```

## 5. Large lists with virtualization

```html
<div d-virtual-each="rows" d-key="id" d-virtual-item-height="40">
  <span>{title}</span>
</div>
```

Use `d-virtual-each` for large datasets to limit DOM node count.
