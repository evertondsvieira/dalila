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

import { signal, type Signal } from '../core/signal.js';
import { getCurrentScope } from '../core/scope.js';
import { createFieldArray } from './field-array.js';
import { findFormFieldElement, resetFormDomFields } from './form-dom.js';
import { parseFormData } from './parse-form-data.js';
import { cssEscape, getNestedValue, setNestedValue } from './path-utils.js';
import { createPathWatchStore } from './path-watchers.js';
import { createValidationController, isPromiseLike } from './validation-pipeline.js';
import type {
  Form,
  InternalForm,
  FormOptions,
  FieldErrors,
  FormSubmitContext,
  FieldArray,
  FormSchemaAdapter,
  FormFieldRef,
} from './form-types.js';

// Wrapped Handler Symbol

/**
 * Symbol to mark handlers that have been wrapped by handleSubmit().
 * Used by bindForm to avoid double-wrapping.
 */
export const WRAPPED_HANDLER = Symbol('dalila.wrappedHandler');

export { parseFormData };

// Form Implementation

export function createForm<T = unknown>(
  options: FormOptions<T> = {}
): Form<T> {
  const scope = getCurrentScope();

  // State
  const errors = signal<FieldErrors>({});
  const formErrorSignal = signal<string | null>(null);
  const touchedSet = signal<Set<string>>(new Set());
  const dirtySet = signal<Set<string>>(new Set());
  const submittingSignal = signal<boolean>(false);
  const submitCountSignal = signal<number>(0);

  // Registry
  const fieldRegistry = new Map<string, HTMLElement>();
  const fieldArrayRegistry = new Map<string, FieldArray<any>>();
  // Form element reference
  let formElement: HTMLFormElement | null = null;

  // Submit abort controller
  let submitController: AbortController | null = null;

  // Default values
  let defaultValues: Partial<T> = {};
  let defaultsInitialized = false;

  function getCurrentSnapshot(preferFieldArrayPaths?: Set<string>): unknown {
    const snapshot: any = formElement
      ? (options.parse ?? parseFormData)(formElement, new FormData(formElement))
      : {};

    // Field arrays may exist before DOM render; overlay them when DOM snapshot
    // has no value for that path, or when callers explicitly prefer array state
    // (useful during reorder mutations before DOM patches apply).
    for (const [path, array] of fieldArrayRegistry) {
      const hasDomValue = getNestedValue(snapshot, path) !== undefined;
      const shouldPreferArrayState = preferFieldArrayPaths?.has(path) === true;
      if (hasDomValue && !shouldPreferArrayState) continue;
      const rows = array.fields().map((item) => item.value);
      setNestedValue(snapshot, path, rows);
    }

    return snapshot;
  }

  function readPathValue(path: string, preferFieldArrayPaths?: Set<string>): unknown {
    return getNestedValue(getCurrentSnapshot(preferFieldArrayPaths), path);
  }

  function isPathRelated(pathA: string, pathB: string): boolean {
    if (pathA === pathB) return true;
    if (pathA.startsWith(`${pathB}.`) || pathA.startsWith(`${pathB}[`)) return true;
    if (pathB.startsWith(`${pathA}.`) || pathB.startsWith(`${pathA}[`)) return true;
    return false;
  }

  const pathWatchStore = createPathWatchStore({
    readPathValue,
    isPathRelated,
    onCallbackError: (err) => {
      if (typeof console !== 'undefined') {
        console.error('[Dalila] Error in form.watch callback:', err);
      }
    },
  });

  function notifyWatchers(
    changedPath?: string,
    opts: { preferFieldArrayPath?: string; preferFieldArrayPaths?: Iterable<string> } = {}
  ): void {
    pathWatchStore.notify({ changedPath, ...opts });
  }

  // Initialize defaults
  (async () => {
    try {
      const dv = options.defaultValues;
      if (dv) {
        if (typeof dv === 'function') {
          const result = dv();
          defaultValues = result instanceof Promise ? await result : result;
        } else {
          defaultValues = dv;
        }
      }

      // Hydrate any field arrays created before async defaults resolved
      for (const [path, array] of fieldArrayRegistry) {
        if (array.length() === 0) {
          const initialValue = getNestedValue(defaultValues, path);
          if (Array.isArray(initialValue)) {
            array.replace(initialValue);
          }
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.error('[Dalila] Failed to initialize form defaultValues:', err);
      }
    } finally {
      defaultsInitialized = true;
    }
  })();

  // Validation mode
  const validateOn = options.validateOn ?? 'submit';
  let hasSubmitted = false;
  const validationController = createValidationController<T>({
    options,
    getNestedValue,
    isPathRelated,
    errors,
    formErrorSignal,
  });

  // Error Management
  function setError(path: string, message: string): void {
    errors.update((prev) => ({ ...prev, [path]: message }));
  }

  function setFormError(message: string): void {
    formErrorSignal.set(message);
  }

  function clearErrors(prefix?: string): void {
    if (!prefix) {
      errors.set({});
      formErrorSignal.set(null);
      return;
    }

    errors.update((prev) => {
      const next: FieldErrors = {};
      for (const [key, value] of Object.entries(prev)) {
        if (!key.startsWith(prefix)) {
          next[key] = value;
        }
      }
      return next;
    });
  }

  function error(path: string): string | null {
    return errors()[path] ?? null;
  }

  function formError(): string | null {
    return formErrorSignal();
  }

  function watch(path: string, fn: (next: unknown, prev: unknown) => void): () => void {
    const watcher = pathWatchStore.add(path, fn);

    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      pathWatchStore.remove(watcher);
    };

    const ownerScope = getCurrentScope();
    if (ownerScope) {
      ownerScope.onCleanup(unsubscribe);
    }

    return unsubscribe;
  }

  function field(path: string): FormFieldRef {
    return {
      path,
      error: () => error(path),
      touched: () => touched(path),
      dirty: () => dirty(path),
      focus: () => focus(path),
      watch: (fn) => watch(path, fn),
    };
  }
  // Touched / Dirty Management
  function touched(path: string): boolean {
    return touchedSet().has(path);
  }

  function markTouched(path: string): void {
    touchedSet.update((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }

  function dirty(path: string): boolean {
    return dirtySet().has(path);
  }

  function markDirty(path: string, isDirty: boolean): void {
    dirtySet.update((prev) => {
      const next = new Set(prev);
      if (isDirty) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }
  // Validation
  function validate(data: T, opts: { path?: string } = {}): boolean | Promise<boolean> {
    return validationController.validate(data, opts);
  }

  function validateForSubmit(
    data: T
  ): { isValid: boolean; data: T } | Promise<{ isValid: boolean; data: T }> {
    return validationController.validateForSubmit(data);
  }
  // Field Registry
  function _registerField(path: string, element: HTMLElement): () => void {
    fieldRegistry.set(path, element);

    // Helper to get current path from DOM (handles array reordering)
    // After d-array reorders items, data-field-path is updated but handlers
    // were registered with the old path. This helper reads the current path.
    const getCurrentPath = (): string => {
      return element.getAttribute('data-field-path') || element.getAttribute('name') || path;
    };

    // Setup blur handler for touched + validation
    const handleBlur = () => {
      // Use dynamic path lookup instead of captured path
      const currentPath = getCurrentPath();
      markTouched(currentPath);

      if (hasSubmitted && validateOn === 'blur' && formElement) {
        const fd = new FormData(formElement);
        const parser = options.parse ?? parseFormData;
        const data = parser(formElement, fd);
        const result = validate(data, { path: currentPath });
        if (isPromiseLike(result)) {
          void result.catch((err) => {
            if (typeof console !== 'undefined') {
              console.error('[Dalila] Field validation failed:', err);
            }
          });
        }
      }
    };

    element.addEventListener('blur', handleBlur);

    // Setup change handler for dirty + validation
    const handleChange = () => {
      // Use dynamic path lookup instead of captured path
      const currentPath = getCurrentPath();
      if (!defaultsInitialized) {
        notifyWatchers(currentPath);
        return;
      }

      const input = element as HTMLInputElement;
      const defaultValue = getNestedValue(defaultValues, currentPath);
      let currentValue: any;

      // Normalize currentValue to match defaultValue type/shape
      // This prevents checkbox groups, select multiple, and number inputs
      // from staying permanently dirty when user restores default state
      if (input.type === 'checkbox') {
        if (Array.isArray(defaultValue)) {
          // Multiple checkboxes: collect all checked values with same name
          const checkboxes = formElement?.querySelectorAll<HTMLInputElement>(
            `input[type="checkbox"][name="${cssEscape(currentPath)}"]`
          );
          currentValue = Array.from(checkboxes || [])
            .filter(cb => cb.checked)
            .map(cb => cb.value);
        } else {
          // Single checkbox: boolean
          currentValue = input.checked;
        }
      } else if (input.type === 'file') {
        currentValue = input.files?.[0];
      } else if (input.type === 'number') {
        // Parse to number to match default type
        const num = parseFloat(input.value);
        currentValue = isNaN(num) ? input.value : num;
      } else if (element.tagName === 'SELECT') {
        // Select multiple: collect selected values as array
        const select = element as HTMLSelectElement;
        if (select.multiple) {
          currentValue = Array.from(select.selectedOptions).map(opt => opt.value);
        } else {
          currentValue = select.value;
        }
      } else {
        currentValue = input.value;
      }

      // Deep comparison for arrays
      let isDirty: boolean;
      if (Array.isArray(currentValue) && Array.isArray(defaultValue)) {
        isDirty = currentValue.length !== defaultValue.length ||
          currentValue.some((v, i) => v !== defaultValue[i]);
      } else {
        isDirty = currentValue !== defaultValue;
      }

      markDirty(currentPath, isDirty);

      if (hasSubmitted && validateOn === 'change' && formElement) {
        const fd = new FormData(formElement);
        const parser = options.parse ?? parseFormData;
        const data = parser(formElement, fd);
        const result = validate(data, { path: currentPath });
        if (isPromiseLike(result)) {
          void result.catch((err) => {
            if (typeof console !== 'undefined') {
              console.error('[Dalila] Field validation failed:', err);
            }
          });
        }
      }

      notifyWatchers(currentPath);
    };

    element.addEventListener('change', handleChange);
    element.addEventListener('input', handleChange);

    // Cleanup - use initial path since that's what was registered
    const cleanup = () => {
      fieldRegistry.delete(path);
      element.removeEventListener('blur', handleBlur);
      element.removeEventListener('change', handleChange);
      element.removeEventListener('input', handleChange);
    };

    if (scope) {
      scope.onCleanup(cleanup);
    }

    return cleanup;
  }
  // Submit Handler
  function handleSubmit(
    handler: (data: T, ctx: FormSubmitContext) => Promise<unknown> | unknown
  ): (ev: SubmitEvent) => void {
    const wrappedHandler = async (ev: SubmitEvent) => {
      ev.preventDefault();

      const form = ev.target as HTMLFormElement;
      formElement = form;

      // Cancel previous submit
      submitController?.abort();
      submitController = new AbortController();
      const signal = submitController.signal;
      const localController = submitController;

      submittingSignal.set(true);
      submitCountSignal.update((n) => n + 1);
      hasSubmitted = true;

      clearErrors();

      try {
        // Parse form data
        const fd = new FormData(form);
        const parser = options.parse ?? parseFormData;
        const data = parser(form, fd);

        // Validate
        const validation = await Promise.resolve(validateForSubmit(data));
        const isValid = validation.isValid;
        if (!isValid) {
          focus(); // Focus first error
          return;
        }

        // Call handler
        await handler(validation.data, { signal });

        // If aborted, don't do anything
        if (signal.aborted) return;

        // Success: clear form state
        touchedSet.set(new Set());
        dirtySet.set(new Set());
      } catch (err) {
        // If aborted, don't do anything
        if (signal.aborted) return;

        // Transform server errors
        if (options.transformServerErrors) {
          const transformed = options.transformServerErrors(err);
          if (transformed) {
            if (transformed.fieldErrors) {
              errors.set(transformed.fieldErrors);
            }
            if (transformed.formError) {
              formErrorSignal.set(transformed.formError);
            }
          }
        } else {
          // Default: set generic form error
          formErrorSignal.set(
            err instanceof Error ? err.message : 'An error occurred'
          );
        }

        focus(); // Focus first error
      } finally {
        // Only update submitting if this is still the latest submit
        if (submitController === localController) {
          submittingSignal.set(false);
        }
      }
    };

    // Mark as wrapped to prevent double-wrapping in bindForm
    (wrappedHandler as any)[WRAPPED_HANDLER] = true;
    return wrappedHandler;
  }
  function focus(path?: string): void {
    if (path) {
      const el = findFormFieldElement(formElement, path);
      if (el && 'focus' in el) {
        (el as HTMLInputElement).focus();
      }
      return;
    }

    // Focus first error
    const errorEntries = Object.entries(errors());
    if (errorEntries.length === 0) return;

    const [firstErrorPath] = errorEntries[0];
    const el = findFormFieldElement(formElement, firstErrorPath);
    if (el && 'focus' in el) {
      (el as HTMLInputElement).focus();
    }
  }
  // Reset
  function reset(nextDefaults?: Partial<T>): void {
    if (nextDefaults !== undefined) {
      defaultValues = nextDefaults;
    }

    // Reset form element + reapply defaults to d-field controls.
    resetFormDomFields(formElement, defaultValues);

    // Reset state
    clearErrors();
    touchedSet.set(new Set());
    dirtySet.set(new Set());
    submitCountSignal.set(0);
    hasSubmitted = false;

    // Reset field arrays to default values
    for (const [path, array] of fieldArrayRegistry) {
      const defaultValue = getNestedValue(defaultValues, path);
      if (Array.isArray(defaultValue)) {
        array.replace(defaultValue);
      } else {
        array.clear();
      }
    }

    // Abort any in-flight submit
    submitController?.abort();
    submitController = null;
    submittingSignal.set(false);

    notifyWatchers(undefined, { preferFieldArrayPaths: fieldArrayRegistry.keys() });
  }
  // Field Arrays
  function fieldArray<TItem = unknown>(path: string): FieldArray<TItem> {
    // Return existing if already created
    if (fieldArrayRegistry.has(path)) {
      return fieldArrayRegistry.get(path)!;
    }

    // Create new field array with meta-state remapping support
    const array = createFieldArray<TItem>(path, {
      form: formElement,
      scope,
      onMutate: () => notifyWatchers(path, { preferFieldArrayPath: path }),
      // Pass meta-state signals for remapping on reorder
      errors,
      touchedSet,
      dirtySet,
    });

    // Register before hydration so watch reads can see this array immediately.
    fieldArrayRegistry.set(path, array);

    // Initialize from defaultValues if available
    // When d-array is first rendered, it should start with values from defaultValues
    if (defaultsInitialized) {
      const initialValue = getNestedValue(defaultValues, path);
      if (Array.isArray(initialValue)) {
        array.replace(initialValue as TItem[]);
      }
    }

    return array;
  }
  // Getters
  function submitting(): boolean {
    return submittingSignal();
  }

  function submitCount(): number {
    return submitCountSignal();
  }

  function _getFormElement(): HTMLFormElement | null {
    return formElement;
  }

  function _setFormElement(form: HTMLFormElement): void {
    formElement = form;
    notifyWatchers();
  }

  // Cleanup on scope disposal
  if (scope) {
    scope.onCleanup(() => {
      submitController?.abort();
      fieldRegistry.clear();
      fieldArrayRegistry.clear();
      pathWatchStore.clear();
    });
  }

  const api: InternalForm<T> = {
    handleSubmit,
    reset,
    setError,
    setFormError,
    clearErrors,
    error,
    formError,
    touched,
    dirty,
    submitting,
    submitCount,
    focus,
    watch,
    field,
    _registerField,
    _getFormElement,
    _setFormElement,
    fieldArray,
  };

  return api;
}

/**
 * Convenience factory for the common schema-first case.
 * Equivalent to `createForm({ ...options, schema })`.
 */
export function createFormFromSchema<T = unknown>(
  schema: FormSchemaAdapter<T>,
  options: Omit<FormOptions<T>, 'schema'> = {}
): Form<T> {
  return createForm<T>({ ...options, schema });
}
