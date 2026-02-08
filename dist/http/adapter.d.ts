/**
 * Fetch Adapter
 *
 * Native fetch-based HTTP adapter with timeout and abort support.
 * Uses only browser/Node native APIs (fetch, AbortController, URL).
 */
import { type RequestConfig, type HttpResponse } from './types.js';
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
export declare function fetchAdapter<T = any>(config: RequestConfig): Promise<HttpResponse<T>>;
