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
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);

  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || null;
  }

  return null;
}

/**
 * Extract XSRF token from meta tag.
 */
export function getMetaTag(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const element = document.querySelector(`meta[name="${name}"]`);
  return element?.getAttribute('content') || null;
}

/**
 * Get XSRF token (tries cookie first, then meta tag fallback).
 */
export function getXsrfToken(cookieName: string): string | null {
  const fromCookie = getCookie(cookieName);
  if (fromCookie) return fromCookie;

  // Fallback to common meta tag names
  return getMetaTag('csrf-token') || getMetaTag('xsrf-token');
}

/**
 * Check if HTTP method requires XSRF token.
 * Safe methods (GET, HEAD, OPTIONS) don't need tokens.
 */
export function requiresXsrfToken(method: HttpMethod, safeMethods: HttpMethod[]): boolean {
  return !safeMethods.includes(method);
}
