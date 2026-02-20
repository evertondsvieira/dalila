/**
 * Type utilities for path-based access
 */

export type FieldErrors = Record<string, string>;

export interface FormSubmitContext {
  signal: AbortSignal;
}

export interface FormOptions<T> {
  /**
   * Default values for the form.
   * Can be a static object, a function returning values, or a promise.
   */
  defaultValues?: Partial<T> | (() => Partial<T>) | (() => Promise<Partial<T>>);

  /**
   * Custom parser for FormData → T.
   * If not provided, uses the built-in parser with dot/bracket notation.
   */
  parse?: (formEl: HTMLFormElement, fd: FormData) => T;

  /**
   * Client-side validation function.
   * Returns { fieldErrors?, formError? } or just fieldErrors.
   */
  validate?: (
    data: T
  ) => FieldErrors | { fieldErrors?: FieldErrors; formError?: string } | void;

  /**
   * When to run validation:
   * - "submit" (default): only on submit
   * - "blur": on field blur after first submit
   * - "change": on every change after first submit
   */
  validateOn?: 'submit' | 'blur' | 'change';

  /**
   * Transform server errors into form errors.
   * Useful for mapping backend error formats to field paths.
   */
  transformServerErrors?: (
    error: unknown
  ) => { fieldErrors?: FieldErrors; formError?: string } | void;
}

export interface Form<T> {
  /**
   * Creates a submit handler that:
   * - prevents default
   * - collects FormData
   * - parses to T
   * - validates (if configured)
   * - calls handler with data and AbortSignal
   * - cancels previous submit if re-submitted
   */
  handleSubmit(
    handler: (data: T, ctx: FormSubmitContext) => Promise<unknown> | unknown
  ): (ev: SubmitEvent) => void;

  /**
   * Reset form to initial/new defaults
   */
  reset(nextDefaults?: Partial<T>): void;

  /**
   * Set error for a specific field
   */
  setError(path: string, message: string): void;

  /**
   * Set form-level error
   */
  setFormError(message: string): void;

  /**
   * Clear errors (all or by prefix)
   */
  clearErrors(prefix?: string): void;

  /**
   * Get error message for a field
   */
  error(path: string): string | null;

  /**
   * Get form-level error
   */
  formError(): string | null;

  /**
   * Check if field has been touched
   */
  touched(path: string): boolean;

  /**
   * Check if field is dirty (value differs from default)
   */
  dirty(path: string): boolean;

  /**
   * Check if form is currently submitting
   */
  submitting(): boolean;

  /**
   * Get submit count
   */
  submitCount(): number;

  /**
   * Focus first error field (or specific field)
   */
  focus(path?: string): void;

  /**
   * Internal: register a field element
   * @internal
   */
  _registerField(path: string, element: HTMLElement): () => void;

  /**
   * Internal: get form element
   * @internal
   */
  _getFormElement(): HTMLFormElement | null;

  /**
   * Internal: set form element
   * @internal
   */
  _setFormElement(form: HTMLFormElement): void;

  /**
   * Create or get a field array
   */
  fieldArray<TItem = unknown>(path: string): FieldArray<TItem>;

  /**
   * Watch a specific path and run callback when its value changes.
   * Returns an idempotent unsubscribe function.
   */
  watch(path: string, fn: (next: unknown, prev: unknown) => void): () => void;
}

export interface FieldArrayItem<T = unknown> {
  key: string;
  value?: T;
}

export interface FieldArray<TItem = unknown> {
  /**
   * Get array of items with stable keys
   */
  fields(): FieldArrayItem<TItem>[];

  /**
   * Append item(s) to the end
   */
  append(value: TItem | TItem[]): void;

  /**
   * Remove item by key
   */
  remove(key: string): void;

  /**
   * Remove item by index
   */
  removeAt(index: number): void;

  /**
   * Insert item at index
   */
  insert(index: number, value: TItem): void;

  /**
   * Move item from one index to another
   */
  move(fromIndex: number, toIndex: number): void;

  /**
   * Swap two items by index
   */
  swap(indexA: number, indexB: number): void;

  /**
   * Replace entire array
   */
  replace(values: TItem[]): void;

  /**
   * Update a specific item by key
   */
  update(key: string, value: TItem): void;

  /**
   * Update a specific item by index
   */
  updateAt(index: number, value: TItem): void;

  /**
   * Clear all items
   */
  clear(): void;

  /**
   * Get current length
   */
  length(): number;

  /**
   * Internal: translate index-based path to key-based path
   * @internal
   */
  _translatePath(path: string): string | null;

  /**
   * Internal: get current index for a key
   * @internal
   */
  _getIndex(key: string): number;
}
