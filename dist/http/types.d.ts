/**
 * HTTP Client Types
 *
 * Type definitions for the Dalila HTTP client.
 * Designed for simplicity and SPA-first workflows.
 */
/**
 * HTTP methods supported by the client.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
/**
 * Request configuration.
 */
export interface RequestConfig {
    /** Request URL (relative to baseURL if configured). */
    url?: string;
    /** HTTP method (defaults to GET). */
    method?: HttpMethod;
    /** Request headers. */
    headers?: Record<string, string>;
    /** Request body (auto-serialized to JSON if object). */
    data?: any;
    /** URL query parameters. */
    params?: Record<string, string | number | boolean>;
    /** Request timeout in milliseconds. */
    timeout?: number;
    /** AbortSignal for manual cancellation. */
    signal?: AbortSignal;
    /** Response type (defaults to 'json'). */
    responseType?: 'json' | 'text' | 'blob' | 'arraybuffer';
    /** Base URL for this request (overrides global baseURL). */
    baseURL?: string;
}
/**
 * HTTP response.
 */
export interface HttpResponse<T = any> {
    /** Response data (parsed). */
    data: T;
    /** HTTP status code. */
    status: number;
    /** HTTP status text. */
    statusText: string;
    /** Response headers. */
    headers: Headers;
    /** Original request config. */
    config: RequestConfig;
}
/**
 * Error types for predictable error handling.
 */
export type HttpErrorType = 'network' | 'timeout' | 'abort' | 'http' | 'parse';
/**
 * HTTP error with structured information.
 */
export declare class HttpError extends Error {
    /** Error type (network, timeout, http, etc). */
    type: HttpErrorType;
    /** HTTP status code (if available). */
    status?: number;
    /** Response data (if available). */
    data?: any;
    /** Original request config. */
    config: RequestConfig;
    /** Native Response object (if available). */
    response?: Response;
    constructor(message: string, type: HttpErrorType, config: RequestConfig, options?: {
        status?: number;
        data?: any;
        response?: Response;
    });
}
/**
 * Request interceptor.
 * Called before each request is sent.
 * Can modify config or throw to abort the request.
 */
export type RequestInterceptor = (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;
/**
 * Response interceptor.
 * Called after each successful response.
 * Can transform the response or throw to convert success to error.
 */
export type ResponseInterceptor = <T = any>(response: HttpResponse<T>) => HttpResponse<T> | Promise<HttpResponse<T>>;
/**
 * Error interceptor.
 * Called when a request fails.
 * Can recover from errors or rethrow.
 */
export type ErrorInterceptor = (error: HttpError) => never | Promise<never>;
/**
 * Interceptor hooks.
 */
export interface Interceptors {
    /** Called before each request. */
    onRequest?: RequestInterceptor;
    /** Called after each successful response. */
    onResponse?: ResponseInterceptor;
    /** Called when a request fails. */
    onError?: ErrorInterceptor;
}
/**
 * XSRF (CSRF) protection configuration.
 */
export interface XsrfConfig {
    /** Name of the cookie where the token is stored (default: 'XSRF-TOKEN'). */
    cookieName?: string;
    /** Name of the header to send the token in (default: 'X-XSRF-TOKEN'). */
    headerName?: string;
    /** HTTP methods that don't require XSRF protection (default: ['GET', 'HEAD', 'OPTIONS']). */
    safeMethods?: HttpMethod[];
}
/**
 * HTTP client configuration.
 */
export interface HttpClientConfig extends Interceptors {
    /** Base URL for all requests. */
    baseURL?: string;
    /** Default headers for all requests. */
    headers?: Record<string, string>;
    /** Default timeout in milliseconds. */
    timeout?: number;
    /** Default response type. */
    responseType?: 'json' | 'text' | 'blob' | 'arraybuffer';
    /**
     * XSRF (CSRF) protection configuration.
     * - `true`: Enable with defaults (cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN')
     * - `false`: Disable XSRF protection
     * - `XsrfConfig`: Custom configuration
     */
    xsrf?: boolean | XsrfConfig;
}
/**
 * HTTP client instance.
 */
export interface HttpClient {
    /** Make a request with full config. */
    request<T = any>(config: RequestConfig): Promise<HttpResponse<T>>;
    /** GET request. */
    get<T = any>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<HttpResponse<T>>;
    /** POST request. */
    post<T = any>(url: string, data?: any, config?: Omit<RequestConfig, 'url' | 'method' | 'data'>): Promise<HttpResponse<T>>;
    /** PUT request. */
    put<T = any>(url: string, data?: any, config?: Omit<RequestConfig, 'url' | 'method' | 'data'>): Promise<HttpResponse<T>>;
    /** PATCH request. */
    patch<T = any>(url: string, data?: any, config?: Omit<RequestConfig, 'url' | 'method' | 'data'>): Promise<HttpResponse<T>>;
    /** DELETE request. */
    delete<T = any>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<HttpResponse<T>>;
}
