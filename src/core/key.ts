export type QueryKeyPart = string | number | boolean | null | undefined | symbol;
export type QueryKey = readonly QueryKeyPart[] | string;

/** Dev mode flag for warnings. */
let devMode = true;

/**
 * Enable or disable dev mode warnings for key encoding.
 */
export function setKeyDevMode(enabled: boolean): void {
  devMode = enabled;
}

/**
 * Helper to build an array key with good inference and stable readonly typing.
 *
 * Example:
 *   key("user", userId())
 *
 * Note: Objects are not valid key parts. Use primitive values only.
 */
export function key<const T extends readonly QueryKeyPart[]>(...parts: T): T {
  if (devMode) {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part !== null && typeof part === 'object') {
        console.warn(
          `[Dalila] key() received an object at index ${i}. ` +
          `Objects are not stable key parts and may cause cache misses. ` +
          `Use primitive values (string, number, boolean) instead.`
        );
      }
    }
  }
  return parts;
}

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
export function encodeKey(k: QueryKey): EncodedKey {
  if (typeof k === "string") return "k|str|" + escapeKeyString(k);
  return "k|arr|" + k.map(encodeKeyPart).join(";");
}

/**
 * Runtime guard (handy for debugging / devtools).
 */
export function isQueryKey(v: unknown): v is QueryKey {
  return typeof v === "string" || Array.isArray(v);
}

function escapeKeyString(s: string): string {
  // No replaceAll: keep ES2020 typing compatibility.
  // Escape characters used by our encoding format: \ ; | :
  return s
    .split("\\")
    .join("\\\\")
    .split(";")
    .join("\\;")
    .split("|")
    .join("\\|")
    .split(":")
    .join("\\:");
}

function encodeKeyPart(v: QueryKeyPart): string {
  switch (typeof v) {
    case "string":
      return "str:" + escapeKeyString(v);

    case "number":
      if (Object.is(v, -0)) return "num:-0";
      if (Number.isNaN(v)) return "num:NaN";
      return "num:" + String(v);

    case "boolean":
      return "bool:" + (v ? "1" : "0");

    case "undefined":
      return "undef";

    case "symbol":
      // Symbol descriptions are not guaranteed unique, but this is stable for a single runtime.
      // For truly stable keys, prefer strings/numbers/booleans.
      return "sym:" + escapeKeyString(String(v));

    default:
      return "null";
  }
}
