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
import { parseFormData } from './parse-form-data.js';
import type { Form, FormOptions, FormSchemaAdapter } from './form-types.js';
/**
 * Symbol to mark handlers that have been wrapped by handleSubmit().
 * Used by bindForm to avoid double-wrapping.
 */
export declare const WRAPPED_HANDLER: unique symbol;
export { parseFormData };
export declare function createForm<T = unknown>(options?: FormOptions<T>): Form<T>;
/**
 * Convenience factory for the common schema-first case.
 * Equivalent to `createForm({ ...options, schema })`.
 */
export declare function createFormFromSchema<T = unknown>(schema: FormSchemaAdapter<T>, options?: Omit<FormOptions<T>, 'schema'>): Form<T>;
