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
 */
export declare function parseFormData<T = unknown>(form: HTMLFormElement, fd: FormData): T;
