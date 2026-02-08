/**
 * XSRF (CSRF) Protection Utilities
 *
 * Helpers for reading XSRF tokens from cookies/meta tags and
 * determining which HTTP methods require protection.
 */
import type { HttpMethod } from './types.js';
/**
 * Extract value from a cookie by name.
 */
export declare function getCookie(name: string): string | null;
/**
 * Extract XSRF token from meta tag.
 */
export declare function getMetaTag(name: string): string | null;
/**
 * Get XSRF token (tries cookie first, then meta tag fallback).
 */
export declare function getXsrfToken(cookieName: string): string | null;
/**
 * Check if HTTP method requires XSRF token.
 * Safe methods (GET, HEAD, OPTIONS) don't need tokens.
 */
export declare function requiresXsrfToken(method: HttpMethod, safeMethods: HttpMethod[]): boolean;
