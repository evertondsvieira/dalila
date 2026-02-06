/**
 * Dalila Forms - DOM-first reactive form management
 *
 * Design principles:
 * - Values live in the DOM (uncontrolled by default)
 * - Meta-state in memory (errors, touched, dirty, submitting)
 * - Declarative HTML via directives
 * - Scope-safe with automatic cleanup
 * - Race-safe submits with AbortController
 * - Field arrays with stable keys
 */
import type { Form, FormOptions } from './form-types.js';
/**
 * Symbol to mark handlers that have been wrapped by handleSubmit().
 * Used by bindForm to avoid double-wrapping.
 */
export declare const WRAPPED_HANDLER: unique symbol;
/**
 * Parse FormData into a nested object structure.
 *
 * Supports:
 * - Simple fields: "email" → { email: "..." }
 * - Nested objects: "user.name" → { user: { name: "..." } }
 * - Arrays: "phones[0].number" → { phones: [{ number: "..." }] }
 * - Checkboxes: single = boolean, multiple = array of values
 * - Select multiple: array of selected values
 * - Radio: single value
 * - Files: File object
 *
 * ## Checkbox Parsing Contract
 *
 * HTML FormData omits unchecked checkboxes entirely. To resolve this ambiguity,
 * parseFormData() inspects the DOM to distinguish between "field missing" vs "checkbox unchecked".
 *
 * ### Single Checkbox (one input with unique name)
 * When there is exactly ONE checkbox with a given name:
 * - Checked (with or without value) → `true`
 * - Unchecked → `false`
 * - Value attribute is ignored (always returns boolean)
 *
 * Example:
 * ```html
 * <input type="checkbox" name="agree" />
 * ```
 * Result: `{ agree: false }` (unchecked) or `{ agree: true }` (checked)
 *
 * ### Multiple Checkboxes (same name, multiple inputs)
 * When there are MULTIPLE checkboxes with the same name:
 * - Result is ALWAYS an array
 * - Some checked → `["value1", "value2"]`
 * - None checked → `[]`
 * - One checked → `["value1"]` (still an array!)
 *
 * Example:
 * ```html
 * <input type="checkbox" name="colors" value="red" checked />
 * <input type="checkbox" name="colors" value="blue" />
 * <input type="checkbox" name="colors" value="green" checked />
 * ```
 * Result: `{ colors: ["red", "green"] }`
 *
 * ### Edge Cases
 * - Radio buttons: Unchecked radio → field absent (standard HTML behavior)
 * - Select multiple: Always returns array (like multiple checkboxes)
 *
 * @param form - The form element to parse (used for DOM inspection)
 * @param fd - FormData instance from the form
 * @returns Parsed form data with nested structure
 */
export declare function parseFormData<T = unknown>(form: HTMLFormElement, fd: FormData): T;
export declare function createForm<T = unknown>(options?: FormOptions<T>): Form<T>;
