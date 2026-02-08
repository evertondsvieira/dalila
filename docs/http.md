# HTTP Client

Native HTTP client for Dalila. Zero dependencies, fetch-based, with built-in XSRF protection and timeout support.

## Quick Start

```ts
import { createHttpClient } from 'dalila/http';

const http = createHttpClient({
  baseURL: 'https://api.example.com',
  timeout: 5000,
  xsrf: true, // XSRF protection enabled
});

// GET request
const response = await http.get('/users');
console.log(response.data);

// POST request
await http.post('/users', {
  name: 'John',
  email: 'john@example.com'
});
```

## API Reference

### createHttpClient

```ts
function createHttpClient(config?: HttpClientConfig): HttpClient

interface HttpClientConfig {
  baseURL?: string;
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob' | 'arraybuffer';
  xsrf?: boolean | XsrfConfig;
  onRequest?: (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;
  onResponse?: (response: HttpResponse) => HttpResponse | Promise<HttpResponse>;
  onError?: (error: HttpError) => never | Promise<never>;
}
```

### HttpClient Methods

```ts
interface HttpClient {
  request<T>(config: RequestConfig): Promise<HttpResponse<T>>;
  get<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>>;
  post<T>(url: string, data?: any, config?: RequestConfig): Promise<HttpResponse<T>>;
  put<T>(url: string, data?: any, config?: RequestConfig): Promise<HttpResponse<T>>;
  patch<T>(url: string, data?: any, config?: RequestConfig): Promise<HttpResponse<T>>;
  delete<T>(url: string, config?: RequestConfig): Promise<HttpResponse<T>>;
}
```

### HttpResponse

```ts
interface HttpResponse<T> {
  data: T;              // Parsed response data
  status: number;       // HTTP status code (200, 404, etc)
  statusText: string;   // Status text ("OK", "Not Found", etc)
  headers: Headers;     // Response headers
  config: RequestConfig; // Original request config
}
```

### HttpError

```ts
class HttpError extends Error {
  type: 'network' | 'timeout' | 'abort' | 'http' | 'parse';
  status?: number;      // HTTP status code (if available)
  data?: any;           // Response body (if available)
  config: RequestConfig; // Original request config
  response?: Response;  // Native Response object (if available)
}
```

## Configuration

### Base URL

All requests will be prefixed with the base URL:

```ts
const http = createHttpClient({
  baseURL: 'https://api.example.com'
});

await http.get('/users');
// GET https://api.example.com/users
```

### Headers

Set default headers for all requests:

```ts
const http = createHttpClient({
  headers: {
    'Authorization': 'Bearer token',
    'X-App-Version': '1.0.0'
  }
});

// Per-request headers (merged with defaults)
await http.get('/users', {
  headers: {
    'X-Custom-Header': 'value'
  }
});
```

### Timeout

Requests that take longer than the timeout will be aborted:

```ts
const http = createHttpClient({
  timeout: 5000 // 5 seconds
});

// Per-request timeout
await http.get('/slow-endpoint', {
  timeout: 10000 // 10 seconds
});
```

### Response Type

Control how the response body is parsed:

```ts
const http = createHttpClient({
  responseType: 'json' // default
});

// Download a file
const response = await http.get('/file.pdf', {
  responseType: 'blob'
});

// Get raw text
const response = await http.get('/file.txt', {
  responseType: 'text'
});
```

## XSRF Protection

XSRF (Cross-Site Request Forgery) protection prevents malicious sites from making authenticated requests on behalf of users.

### How it Works

1. Server sets a token in a cookie (e.g., `XSRF-TOKEN`)
2. Client reads the token from the cookie
3. Client includes the token in a header for non-safe requests (POST, PUT, DELETE)
4. Server validates that the header token matches the cookie token

### Enable XSRF

```ts
const http = createHttpClient({
  xsrf: true // Use defaults
});

// GET request → no XSRF token (safe method)
await http.get('/users');

// POST request → adds X-XSRF-TOKEN header automatically
await http.post('/users', { name: 'John' });
```

### Custom XSRF Config

```ts
const http = createHttpClient({
  xsrf: {
    cookieName: 'csrftoken',     // Django default
    headerName: 'X-CSRFToken',   // Django default
    safeMethods: ['GET', 'HEAD'] // Methods that don't need token
  }
});
```

### When to Use XSRF

**✅ Use XSRF if:**
- You use cookie-based authentication (sessions)
- Your API is accessed from browsers
- You make mutating requests (POST, PUT, DELETE)

**❌ Don't use XSRF if:**
- You use token-based auth (JWT in Authorization header)
- Your API is stateless (no session cookies)
- You only make read-only requests (GET)

**Why JWT doesn't need XSRF:**
```ts
// JWT in header (not sent automatically by browser)
Authorization: Bearer eyJhbGc...

// Session cookie (sent automatically by browser)
Cookie: sessionid=abc123
```

JWTs in the `Authorization` header are not vulnerable to CSRF because browsers don't send them automatically. Attackers cannot make the browser include your JWT.

## Interceptors

Interceptors allow you to modify requests, responses, or handle errors globally.

### Request Interceptor

Called before each request is sent:

```ts
const http = createHttpClient({
  onRequest: (config) => {
    // Add auth token from localStorage
    const token = localStorage.getItem('token');
    if (token) {
      config.headers = {
        ...config.headers,
        'Authorization': `Bearer ${token}`
      };
    }

    console.log('Sending request:', config.method, config.url);
    return config;
  }
});
```

### Response Interceptor

Called after each successful response:

```ts
const http = createHttpClient({
  onResponse: (response) => {
    console.log('Received response:', response.status);

    // Transform data
    if (response.data?.items) {
      response.data.items = response.data.items.map(camelCase);
    }

    return response;
  }
});
```

### Error Interceptor

Called when a request fails:

```ts
const http = createHttpClient({
  onError: (error) => {
    // Redirect to login on 401
    if (error.status === 401) {
      window.location.href = '/login';
    }

    // Log errors
    console.error('[HTTP]', error.type, error.message);

    // Always rethrow
    throw error;
  }
});
```

## Request Configuration

Per-request options override global config:

```ts
await http.get('/users', {
  timeout: 10000,           // Override timeout
  headers: { 'X-Foo': 'bar' }, // Merge with global headers
  params: { page: 1 },      // Query parameters
  signal: abortController.signal, // Manual cancellation
  responseType: 'json'      // Override response type
});
```

### Query Parameters

Automatically encoded and appended to URL:

```ts
await http.get('/search', {
  params: {
    q: 'dalila',
    page: 1,
    limit: 10
  }
});
// GET /search?q=dalila&page=1&limit=10
```

### Manual Cancellation

Cancel requests using AbortController:

```ts
const controller = new AbortController();

http.get('/users', {
  signal: controller.signal
}).catch((error) => {
  if (error.type === 'abort') {
    console.log('Request cancelled');
  }
});

// Cancel the request
controller.abort();
```

## Error Handling

All errors are instances of `HttpError` with structured information:

```ts
try {
  await http.get('/users');
} catch (error) {
  if (error instanceof HttpError) {
    console.log('Type:', error.type);
    console.log('Status:', error.status);
    console.log('Message:', error.message);
    console.log('Data:', error.data);
  }
}
```

### Error Types

| Type | Description | Example |
|------|-------------|---------|
| `network` | Network failure | DNS error, connection refused |
| `timeout` | Request exceeded timeout | No response within timeout period |
| `abort` | Request manually cancelled | AbortController.abort() called |
| `http` | HTTP error response | 404 Not Found, 500 Server Error |
| `parse` | Failed to parse response | Invalid JSON |

### HTTP Status Codes

Non-2xx responses throw `HttpError` with `type: 'http'`:

```ts
try {
  await http.get('/users/999');
} catch (error) {
  if (error.status === 404) {
    console.log('User not found');
  } else if (error.status >= 500) {
    console.log('Server error');
  }
}
```

## Integration with Signals

Combine with signals for reactive data:

```ts
import { signal, effect } from 'dalila';
import { createHttpClient } from 'dalila/http';

const http = createHttpClient({ baseURL: 'https://api.example.com' });

const users = signal([]);
const loading = signal(false);
const error = signal(null);

async function loadUsers() {
  loading.set(true);
  error.set(null);

  try {
    const response = await http.get('/users');
    users.set(response.data);
  } catch (err) {
    error.set(err.message);
  } finally {
    loading.set(false);
  }
}

// Reactive UI
effect(() => {
  if (loading()) {
    console.log('Loading...');
  } else if (error()) {
    console.log('Error:', error());
  } else {
    console.log('Users:', users().length);
  }
});
```

## Integration with Resources

Use with [Resources](./core/resource.md) for automatic loading/error states:

```ts
import { createResource } from 'dalila';
import { createHttpClient } from 'dalila/http';

const http = createHttpClient({ baseURL: 'https://api.example.com' });

const usersResource = createResource(
  async (signal) => {
    const response = await http.get('/users', { signal });
    return response.data;
  }
);

// Automatic states
console.log(usersResource.data());    // User data or null
console.log(usersResource.loading()); // Loading state
console.log(usersResource.error());   // Error or null

// Revalidate
await usersResource.refresh();
```

## Authentication Example

Complete auth flow with token management:

```ts
import { signal } from 'dalila';
import { createHttpClient } from 'dalila/http';

// Auth token signal
const token = signal(localStorage.getItem('token'));

// Create HTTP client with auth interceptor
const http = createHttpClient({
  baseURL: 'https://api.example.com',
  timeout: 5000,

  onRequest: (config) => {
    const authToken = token();
    if (authToken) {
      config.headers = {
        ...config.headers,
        'Authorization': `Bearer ${authToken}`
      };
    }
    return config;
  },

  onError: (error) => {
    if (error.status === 401) {
      // Clear token and redirect
      token.set(null);
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    throw error;
  }
});

// Login
async function login(email: string, password: string) {
  const response = await http.post('/auth/login', { email, password });
  const { token: authToken } = response.data;

  // Save token
  token.set(authToken);
  localStorage.setItem('token', authToken);
}

// Logout
async function logout() {
  await http.post('/auth/logout');
  token.set(null);
  localStorage.removeItem('token');
}

// Make authenticated requests
async function getProfile() {
  const response = await http.get('/profile');
  return response.data;
}
```

## Design Philosophy

The HTTP client is designed with these principles:

1. **Zero dependencies** - Uses only native fetch API
2. **Type-safe** - Full TypeScript support with inference
3. **Predictable errors** - Structured error types
4. **SPA-first** - Built for single-page applications
5. **Simple by default** - Advanced features are opt-in

**What's included:**
- ✅ Timeout (AbortController)
- ✅ Manual cancellation (AbortSignal)
- ✅ XSRF protection
- ✅ Interceptors
- ✅ Type inference
- ✅ Error types

**What's not included:**
- ❌ Upload/download progress (use specialized libs)
- ❌ Retries (implement as needed)
- ❌ Caching (use [Resources](./core/resource.md))

## Bundle Size

~2KB minified + gzipped (including XSRF protection)

## Browser Support

Modern browsers with fetch and AbortController support:
- Chrome 66+
- Firefox 57+
- Safari 12.1+
- Edge 79+
