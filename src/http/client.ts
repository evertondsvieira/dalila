/**
 * HTTP Client
 *
 * Main HTTP client factory for Dalila framework.
 * Provides a simple, Axios-inspired API with native fetch under the hood.
 */

import { fetchAdapter } from './adapter.js';
import { getXsrfToken, requiresXsrfToken } from './xsrf.js';
import {
  type HttpClient,
  type HttpClientConfig,
  type RequestConfig,
  type HttpResponse,
  type HttpMethod,
  type XsrfConfig,
} from './types.js';

/**
 * Create an HTTP client instance.
 *
 * Features:
 * - Global config (baseURL, headers, timeout)
 * - Interceptors (onRequest, onResponse, onError)
 * - Convenient methods (get, post, put, patch, delete)
 * - Full TypeScript support
 *
 * Example:
 * ```ts
 * const http = createHttpClient({
 *   baseURL: 'https://api.example.com',
 *   headers: { 'Authorization': 'Bearer token' },
 *   timeout: 5000,
 *   onRequest: (config) => {
 *     console.log('Sending request:', config.url);
 *     return config;
 *   },
 *   onResponse: (response) => {
 *     console.log('Received response:', response.status);
 *     return response;
 *   },
 *   onError: (error) => {
 *     if (error.status === 401) {
 *       // Redirect to login
 *       window.location.href = '/login';
 *     }
 *     throw error;
 *   }
 * });
 *
 * // Usage
 * const response = await http.get('/users');
 * await http.post('/login', { email, password });
 * ```
 *
 * @param config - Global client configuration
 * @returns HTTP client instance
 */
export function createHttpClient(config: HttpClientConfig = {}): HttpClient {
  const {
    baseURL = '',
    headers: defaultHeaders = {},
    timeout: defaultTimeout,
    responseType: defaultResponseType = 'json',
    xsrf: xsrfConfig,
    onRequest,
    onResponse,
    onError,
  } = config;

  // Parse XSRF config
  const xsrf: XsrfConfig | null = xsrfConfig === true
    ? { cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN', safeMethods: ['GET', 'HEAD', 'OPTIONS'] }
    : xsrfConfig === false || !xsrfConfig
    ? null
    : { cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN', safeMethods: ['GET', 'HEAD', 'OPTIONS'], ...xsrfConfig };

  /**
   * Core request method.
   * Merges global config with per-request config and executes interceptors.
   */
  async function request<T = any>(requestConfig: RequestConfig): Promise<HttpResponse<T>> {
    // Merge global config with request config
    // Spread requestConfig first, then override with merged values
    let mergedConfig: RequestConfig = {
      ...requestConfig,
      baseURL: requestConfig.baseURL ?? baseURL,
      timeout: requestConfig.timeout ?? defaultTimeout,
      responseType: requestConfig.responseType ?? defaultResponseType,
      headers: mergeHeaders(defaultHeaders, requestConfig.headers),
    };

    // XSRF: Add token to header if configured
    if (xsrf) {
      const method = (mergedConfig.method || 'GET') as HttpMethod;
      const safeMethods = xsrf.safeMethods || ['GET', 'HEAD', 'OPTIONS'];

      if (requiresXsrfToken(method, safeMethods)) {
        const cookieName = xsrf.cookieName || 'XSRF-TOKEN';
        const token = getXsrfToken(cookieName);

        if (token) {
          const headerName = xsrf.headerName || 'X-XSRF-TOKEN';
          mergedConfig.headers = {
            ...mergedConfig.headers,
            [headerName]: token,
          };
        }
      }
    }

    try {
      // Run request interceptor
      if (onRequest) {
        mergedConfig = await onRequest(mergedConfig);
      }

      // Execute request
      let response = await fetchAdapter<T>(mergedConfig);

      // Run response interceptor
      if (onResponse) {
        response = await onResponse(response);
      }

      return response;
    } catch (error: any) {
      // Run error interceptor
      if (onError) {
        await onError(error);
      }

      // Rethrow error
      throw error;
    }
  }

  /**
   * GET request.
   */
  function get<T = any>(
    url: string,
    requestConfig?: Omit<RequestConfig, 'url' | 'method'>
  ): Promise<HttpResponse<T>> {
    return request<T>({
      ...requestConfig,
      url,
      method: 'GET',
    });
  }

  /**
   * POST request.
   */
  function post<T = any>(
    url: string,
    data?: any,
    requestConfig?: Omit<RequestConfig, 'url' | 'method' | 'data'>
  ): Promise<HttpResponse<T>> {
    return request<T>({
      ...requestConfig,
      url,
      method: 'POST',
      data,
    });
  }

  /**
   * PUT request.
   */
  function put<T = any>(
    url: string,
    data?: any,
    requestConfig?: Omit<RequestConfig, 'url' | 'method' | 'data'>
  ): Promise<HttpResponse<T>> {
    return request<T>({
      ...requestConfig,
      url,
      method: 'PUT',
      data,
    });
  }

  /**
   * PATCH request.
   */
  function patch<T = any>(
    url: string,
    data?: any,
    requestConfig?: Omit<RequestConfig, 'url' | 'method' | 'data'>
  ): Promise<HttpResponse<T>> {
    return request<T>({
      ...requestConfig,
      url,
      method: 'PATCH',
      data,
    });
  }

  /**
   * DELETE request.
   */
  function deleteFn<T = any>(
    url: string,
    requestConfig?: Omit<RequestConfig, 'url' | 'method'>
  ): Promise<HttpResponse<T>> {
    return request<T>({
      ...requestConfig,
      url,
      method: 'DELETE',
    });
  }

  return {
    request,
    get,
    post,
    put,
    patch,
    delete: deleteFn,
  };
}

/**
 * Merge headers (per-request headers override global headers).
 */
function mergeHeaders(
  globalHeaders: Record<string, string>,
  requestHeaders?: Record<string, string>
): Record<string, string> {
  return {
    ...globalHeaders,
    ...requestHeaders,
  };
}
