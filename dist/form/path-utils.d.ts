/**
 * Path and DOM selector helpers used by the forms module.
 */
/**
 * Parse a path string into an array of keys/indices.
 * Examples:
 * - "email" → ["email"]
 * - "user.name" → ["user", "name"]
 * - "phones[0].number" → ["phones", 0, "number"]
 */
export declare function parsePath(path: string): (string | number)[];
/**
 * Set a value in a nested object using dot/bracket notation.
 */
export declare function setNestedValue(obj: any, path: string, value: any): void;
/**
 * Get a nested value from an object using a path.
 */
export declare function getNestedValue(obj: any, path: string): any;
/**
 * Escape a string for safe use inside a CSS attribute selector.
 * Uses CSS.escape when available, falls back to escaping all non-word chars.
 */
export declare function cssEscape(value: string): string;
