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
import { signal } from '../core/signal.js';
import { getCurrentScope } from '../core/scope.js';
import { createFieldArray } from './field-array.js';
import { findFormFieldElement, resetFormDomFields } from './form-dom.js';
import { parseFormData } from './parse-form-data.js';
import { cssEscape, getNestedValue, setNestedValue } from './path-utils.js';
import { createPathWatchStore } from './path-watchers.js';
import { createValidationController, isPromiseLike } from './validation-pipeline.js';
// Wrapped Handler Symbol
/**
 * Symbol to mark handlers that have been wrapped by handleSubmit().
 * Used by bindForm to avoid double-wrapping.
 */
export const WRAPPED_HANDLER = Symbol('dalila.wrappedHandler');
export { parseFormData };
// Form Implementation
export function createForm(options = {}) {
    const scope = getCurrentScope();
    // State
    const errors = signal({});
    const formErrorSignal = signal(null);
    const touchedSet = signal(new Set());
    const dirtySet = signal(new Set());
    const submittingSignal = signal(false);
    const submitCountSignal = signal(0);
    // Registry
    const fieldRegistry = new Map();
    const fieldArrayRegistry = new Map();
    // Form element reference
    let formElement = null;
    // Submit abort controller
    let submitController = null;
    // Default values
    let defaultValues = {};
    let defaultsInitialized = false;
    function getCurrentSnapshot(preferFieldArrayPaths) {
        const snapshot = formElement
            ? (options.parse ?? parseFormData)(formElement, new FormData(formElement))
            : {};
        // Field arrays may exist before DOM render; overlay them when DOM snapshot
        // has no value for that path, or when callers explicitly prefer array state
        // (useful during reorder mutations before DOM patches apply).
        for (const [path, array] of fieldArrayRegistry) {
            const hasDomValue = getNestedValue(snapshot, path) !== undefined;
            const shouldPreferArrayState = preferFieldArrayPaths?.has(path) === true;
            if (hasDomValue && !shouldPreferArrayState)
                continue;
            const rows = array.fields().map((item) => item.value);
            setNestedValue(snapshot, path, rows);
        }
        return snapshot;
    }
    function readPathValue(path, preferFieldArrayPaths) {
        return getNestedValue(getCurrentSnapshot(preferFieldArrayPaths), path);
    }
    function isPathRelated(pathA, pathB) {
        if (pathA === pathB)
            return true;
        if (pathA.startsWith(`${pathB}.`) || pathA.startsWith(`${pathB}[`))
            return true;
        if (pathB.startsWith(`${pathA}.`) || pathB.startsWith(`${pathA}[`))
            return true;
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
    function notifyWatchers(changedPath, opts = {}) {
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
                }
                else {
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
        }
        catch (err) {
            if (typeof console !== 'undefined') {
                console.error('[Dalila] Failed to initialize form defaultValues:', err);
            }
        }
        finally {
            defaultsInitialized = true;
        }
    })();
    // Validation mode
    const validateOn = options.validateOn ?? 'submit';
    let hasSubmitted = false;
    const validationController = createValidationController({
        options,
        getNestedValue,
        isPathRelated,
        errors,
        formErrorSignal,
    });
    // Error Management
    function setError(path, message) {
        errors.update((prev) => ({ ...prev, [path]: message }));
    }
    function setFormError(message) {
        formErrorSignal.set(message);
    }
    function clearErrors(prefix) {
        if (!prefix) {
            errors.set({});
            formErrorSignal.set(null);
            return;
        }
        errors.update((prev) => {
            const next = {};
            for (const [key, value] of Object.entries(prev)) {
                if (!key.startsWith(prefix)) {
                    next[key] = value;
                }
            }
            return next;
        });
    }
    function error(path) {
        return errors()[path] ?? null;
    }
    function formError() {
        return formErrorSignal();
    }
    function watch(path, fn) {
        const watcher = pathWatchStore.add(path, fn);
        let active = true;
        const unsubscribe = () => {
            if (!active)
                return;
            active = false;
            pathWatchStore.remove(watcher);
        };
        const ownerScope = getCurrentScope();
        if (ownerScope) {
            ownerScope.onCleanup(unsubscribe);
        }
        return unsubscribe;
    }
    function field(path) {
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
    function touched(path) {
        return touchedSet().has(path);
    }
    function markTouched(path) {
        touchedSet.update((prev) => {
            const next = new Set(prev);
            next.add(path);
            return next;
        });
    }
    function dirty(path) {
        return dirtySet().has(path);
    }
    function markDirty(path, isDirty) {
        dirtySet.update((prev) => {
            const next = new Set(prev);
            if (isDirty) {
                next.add(path);
            }
            else {
                next.delete(path);
            }
            return next;
        });
    }
    // Validation
    function validate(data, opts = {}) {
        return validationController.validate(data, opts);
    }
    function validateForSubmit(data) {
        return validationController.validateForSubmit(data);
    }
    // Field Registry
    function _registerField(path, element) {
        fieldRegistry.set(path, element);
        // Helper to get current path from DOM (handles array reordering)
        // After d-array reorders items, data-field-path is updated but handlers
        // were registered with the old path. This helper reads the current path.
        const getCurrentPath = () => {
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
            const input = element;
            const defaultValue = getNestedValue(defaultValues, currentPath);
            let currentValue;
            // Normalize currentValue to match defaultValue type/shape
            // This prevents checkbox groups, select multiple, and number inputs
            // from staying permanently dirty when user restores default state
            if (input.type === 'checkbox') {
                if (Array.isArray(defaultValue)) {
                    // Multiple checkboxes: collect all checked values with same name
                    const checkboxes = formElement?.querySelectorAll(`input[type="checkbox"][name="${cssEscape(currentPath)}"]`);
                    currentValue = Array.from(checkboxes || [])
                        .filter(cb => cb.checked)
                        .map(cb => cb.value);
                }
                else {
                    // Single checkbox: boolean
                    currentValue = input.checked;
                }
            }
            else if (input.type === 'file') {
                currentValue = input.files?.[0];
            }
            else if (input.type === 'number') {
                // Parse to number to match default type
                const num = parseFloat(input.value);
                currentValue = isNaN(num) ? input.value : num;
            }
            else if (element.tagName === 'SELECT') {
                // Select multiple: collect selected values as array
                const select = element;
                if (select.multiple) {
                    currentValue = Array.from(select.selectedOptions).map(opt => opt.value);
                }
                else {
                    currentValue = select.value;
                }
            }
            else {
                currentValue = input.value;
            }
            // Deep comparison for arrays
            let isDirty;
            if (Array.isArray(currentValue) && Array.isArray(defaultValue)) {
                isDirty = currentValue.length !== defaultValue.length ||
                    currentValue.some((v, i) => v !== defaultValue[i]);
            }
            else {
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
    function handleSubmit(handler) {
        const wrappedHandler = async (ev) => {
            ev.preventDefault();
            const form = ev.target;
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
                if (signal.aborted)
                    return;
                // Success: clear form state
                touchedSet.set(new Set());
                dirtySet.set(new Set());
            }
            catch (err) {
                // If aborted, don't do anything
                if (signal.aborted)
                    return;
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
                }
                else {
                    // Default: set generic form error
                    formErrorSignal.set(err instanceof Error ? err.message : 'An error occurred');
                }
                focus(); // Focus first error
            }
            finally {
                // Only update submitting if this is still the latest submit
                if (submitController === localController) {
                    submittingSignal.set(false);
                }
            }
        };
        // Mark as wrapped to prevent double-wrapping in bindForm
        wrappedHandler[WRAPPED_HANDLER] = true;
        return wrappedHandler;
    }
    function focus(path) {
        if (path) {
            const el = findFormFieldElement(formElement, path);
            if (el && 'focus' in el) {
                el.focus();
            }
            return;
        }
        // Focus first error
        const errorEntries = Object.entries(errors());
        if (errorEntries.length === 0)
            return;
        const [firstErrorPath] = errorEntries[0];
        const el = findFormFieldElement(formElement, firstErrorPath);
        if (el && 'focus' in el) {
            el.focus();
        }
    }
    // Reset
    function reset(nextDefaults) {
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
            }
            else {
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
    function fieldArray(path) {
        // Return existing if already created
        if (fieldArrayRegistry.has(path)) {
            return fieldArrayRegistry.get(path);
        }
        // Create new field array with meta-state remapping support
        const array = createFieldArray(path, {
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
                array.replace(initialValue);
            }
        }
        return array;
    }
    // Getters
    function submitting() {
        return submittingSignal();
    }
    function submitCount() {
        return submitCountSignal();
    }
    function _getFormElement() {
        return formElement;
    }
    function _setFormElement(form) {
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
    const api = {
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
export function createFormFromSchema(schema, options = {}) {
    return createForm({ ...options, schema });
}
