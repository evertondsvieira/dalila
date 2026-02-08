/**
 * HTTP Client
 *
 * Main HTTP client factory for Dalila framework.
 * Provides a simple, Axios-inspired API with native fetch under the hood.
 */
import { type HttpClient, type HttpClientConfig } from './types.js';
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
export declare function createHttpClient(config?: HttpClientConfig): HttpClient;
