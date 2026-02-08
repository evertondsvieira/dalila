/**
 * Fetch Adapter
 *
 * Native fetch-based HTTP adapter with timeout and abort support.
 * Uses only browser/Node native APIs (fetch, AbortController, URL).
 */
import { HttpError } from './types.js';
/**
 * Execute an HTTP request using native fetch API.
 *
 * Features:
 * - Timeout support via AbortController
 * - Manual cancellation via config.signal
 * - Automatic JSON serialization
 * - URL params handling
 * - Response type parsing
 *
 * @param config - Request configuration
 * @returns Promise that resolves to HttpResponse
 * @throws HttpError on any failure
 */
export async function fetchAdapter(config) {
    const { url = '', method = 'GET', headers = {}, data, params, timeout, signal: userSignal, responseType = 'json', baseURL = '', } = config;
    // Build full URL
    const fullUrl = buildUrl(baseURL, url, params);
    // Setup abort handling (timeout + manual signal)
    const controller = new AbortController();
    const { signal, cleanup } = setupAbort(controller, timeout, userSignal);
    // Build request headers
    const requestHeaders = buildHeaders(headers, data);
    // Build request body
    const body = buildBody(data);
    let response;
    try {
        // Execute fetch
        response = await fetch(fullUrl, {
            method,
            headers: requestHeaders,
            body,
            signal,
        });
        cleanup();
        // Handle non-2xx responses
        if (!response.ok) {
            const errorData = await parseResponseSafe(response, responseType);
            throw new HttpError(`HTTP Error ${response.status}: ${response.statusText}`, 'http', config, {
                status: response.status,
                data: errorData,
                response,
            });
        }
        // Check if response has a body
        const hasBody = shouldParseResponseBody(response, method);
        // Parse response (or return null for empty responses)
        const responseData = hasBody
            ? await parseResponse(response, responseType)
            : null;
        return {
            data: responseData,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            config,
        };
    }
    catch (error) {
        cleanup();
        // Already an HttpError (from non-2xx response)
        if (error instanceof HttpError) {
            throw error;
        }
        // AbortError (timeout or manual cancel)
        if (error instanceof Error && error.name === 'AbortError') {
            const isTimeout = controller.signal.reason === 'timeout';
            throw new HttpError(isTimeout ? `Request timeout after ${timeout}ms` : 'Request aborted', isTimeout ? 'timeout' : 'abort', config);
        }
        // Parse error (invalid JSON, malformed response body, etc)
        if (error instanceof Error && error.message.startsWith('Failed to parse response')) {
            throw new HttpError(error.message, 'parse', config, {
                status: response?.status,
                response: response,
            });
        }
        // Network error (DNS, connection refused, etc)
        if (error instanceof TypeError) {
            throw new HttpError(`Network error: ${error.message}`, 'network', config);
        }
        // Unknown error (treat as network error for backwards compatibility)
        throw new HttpError(error instanceof Error ? error.message : String(error), 'network', config);
    }
}
/**
 * Check if a URL is absolute (starts with http://, https://, or //).
 */
function isAbsoluteUrl(url) {
    return /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url);
}
/**
 * Build full URL with baseURL and query params.
 */
function buildUrl(baseURL, url, params) {
    // Only prepend baseURL if url is relative
    let fullUrl;
    if (baseURL && !isAbsoluteUrl(url)) {
        fullUrl = `${baseURL}${url}`;
    }
    else {
        fullUrl = url;
    }
    if (params && Object.keys(params).length > 0) {
        // Build query string
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            searchParams.append(key, String(value));
        });
        const queryString = searchParams.toString();
        // Append query string to original URL
        // Preserve URL format (absolute http://, root-relative /, or path-relative)
        if (fullUrl.includes('?')) {
            // URL already has query params, append with &
            fullUrl = `${fullUrl}&${queryString}`;
        }
        else {
            // Add query params with ?
            fullUrl = `${fullUrl}?${queryString}`;
        }
    }
    return fullUrl;
}
/**
 * Build request headers with automatic Content-Type for JSON.
 */
function buildHeaders(headers, data) {
    const result = { ...headers };
    // Auto-add Content-Type for JSON data (but not for FormData/Blob/ArrayBuffer)
    // Browser automatically sets correct Content-Type for FormData/Blob
    if (data &&
        typeof data === 'object' &&
        !(data instanceof FormData) &&
        !(data instanceof Blob) &&
        !(data instanceof ArrayBuffer) &&
        !result['Content-Type'] &&
        !result['content-type']) {
        result['Content-Type'] = 'application/json';
    }
    return result;
}
/**
 * Build request body (auto-stringify JSON objects).
 */
function buildBody(data) {
    // Only skip for null/undefined (not other falsy values like 0, false, "")
    if (data === null || data === undefined) {
        return undefined;
    }
    // Already serialized (string, FormData, Blob, etc)
    if (typeof data === 'string' || data instanceof FormData || data instanceof Blob || data instanceof ArrayBuffer) {
        return data;
    }
    // Serialize objects to JSON
    if (typeof data === 'object') {
        return JSON.stringify(data);
    }
    // Serialize primitives (numbers, booleans, etc) to string
    return String(data);
}
/**
 * Setup abort handling (timeout + manual signal).
 *
 * Returns:
 * - signal: AbortSignal to pass to fetch
 * - cleanup: Function to clear timeout
 */
function setupAbort(controller, timeout, userSignal) {
    let timeoutId;
    // Link user signal (manual cancellation)
    if (userSignal) {
        if (userSignal.aborted) {
            controller.abort(userSignal.reason);
        }
        else {
            userSignal.addEventListener('abort', () => {
                controller.abort(userSignal.reason);
            }, { once: true });
        }
    }
    // Setup timeout
    if (timeout && timeout > 0) {
        timeoutId = setTimeout(() => {
            controller.abort('timeout');
        }, timeout);
    }
    const cleanup = () => {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
        }
    };
    return { signal: controller.signal, cleanup };
}
/**
 * Check if response should be parsed (has a body).
 *
 * Responses without body:
 * - 204 No Content
 * - 205 Reset Content
 * - 304 Not Modified
 * - HEAD requests
 * - Content-Length: 0
 */
function shouldParseResponseBody(response, method) {
    // Status codes that never have a body
    if (response.status === 204 || response.status === 205 || response.status === 304) {
        return false;
    }
    // HEAD requests never have a body
    if (method.toUpperCase() === 'HEAD') {
        return false;
    }
    // Check Content-Length header
    const contentLength = response.headers.get('Content-Length');
    if (contentLength === '0') {
        return false;
    }
    return true;
}
/**
 * Parse response based on responseType.
 */
async function parseResponse(response, responseType) {
    try {
        switch (responseType) {
            case 'json':
                return await response.json();
            case 'text':
                return await response.text();
            case 'blob':
                return await response.blob();
            case 'arraybuffer':
                return await response.arrayBuffer();
            default:
                return await response.json();
        }
    }
    catch (error) {
        throw new Error(`Failed to parse response as ${responseType}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Parse response safely for error handling (never throws).
 */
async function parseResponseSafe(response, responseType) {
    try {
        return await parseResponse(response, responseType);
    }
    catch {
        // If parsing fails, try text as fallback
        try {
            return await response.text();
        }
        catch {
            return null;
        }
    }
}
