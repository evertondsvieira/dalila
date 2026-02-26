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
export function parsePath(path) {
    const parts = [];
    let current = '';
    let i = 0;
    while (i < path.length) {
        const char = path[i];
        if (char === '.') {
            if (current) {
                parts.push(current);
                current = '';
            }
            i++;
        }
        else if (char === '[') {
            if (current) {
                parts.push(current);
                current = '';
            }
            const closeIndex = path.indexOf(']', i);
            if (closeIndex === -1) {
                throw new Error(`Invalid path: missing closing bracket in "${path}"`);
            }
            const index = path.slice(i + 1, closeIndex);
            const parsed = parseInt(index, 10);
            parts.push(isNaN(parsed) ? index : parsed);
            i = closeIndex + 1;
            if (path[i] === '.')
                i++;
        }
        else {
            current += char;
            i++;
        }
    }
    if (current) {
        parts.push(current);
    }
    return parts;
}
/**
 * Set a value in a nested object using dot/bracket notation.
 */
export function setNestedValue(obj, path, value) {
    const parts = parsePath(path);
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const next = parts[i + 1];
        if (!(part in current)) {
            current[part] = typeof next === 'number' ? [] : {};
        }
        current = current[part];
    }
    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
}
/**
 * Get a nested value from an object using a path.
 */
export function getNestedValue(obj, path) {
    if (!obj)
        return undefined;
    const parts = parsePath(path);
    let current = obj;
    for (const part of parts) {
        if (current == null)
            return undefined;
        current = current[part];
    }
    return current;
}
/**
 * Escape a string for safe use inside a CSS attribute selector.
 * Uses CSS.escape when available, falls back to escaping all non-word chars.
 */
export function cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) {
        return CSS.escape(value);
    }
    return value.replace(/([^\w-])/g, '\\$1');
}
