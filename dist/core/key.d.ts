export type QueryKeyPart = string | number | boolean | null | undefined | symbol;
export type QueryKey = readonly QueryKeyPart[] | string;
/**
 * Enable or disable dev mode warnings for key encoding.
 */
export declare function setKeyDevMode(enabled: boolean): void;
/**
 * Helper to build an array key with good inference and stable readonly typing.
 *
 * Example:
 *   key("user", userId())
 *
 * Note: Objects are not valid key parts. Use primitive values only.
 */
export declare function key<const T extends readonly QueryKeyPart[]>(...parts: T): T;
/**
 * Encoded string form of a query key.
 * This is what the cache uses internally as the Map key.
 */
export type EncodedKey = string;
/**
 * Encode a query key to a stable string (ES2020-safe).
 *
 * We avoid JSON.stringify because:
 * - it can be unstable for some values
 * - it is slower
 * - it doesn't encode NaN/-0 consistently
 */
export declare function encodeKey(k: QueryKey): EncodedKey;
/**
 * Runtime guard (handy for debugging / devtools).
 */
export declare function isQueryKey(v: unknown): v is QueryKey;
