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
// Wrapped Handler Symbol
/**
 * Symbol to mark handlers that have been wrapped by handleSubmit().
 * Used by bindForm to avoid double-wrapping.
 */
export const WRAPPED_HANDLER = Symbol('dalila.wrappedHandler');
// FormData Parser
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
export function parseFormData(form, fd) {
    const result = {};
    // Step 1: Identify all enabled checkboxes in the form (to handle unchecked ones)
    // Disabled checkboxes are omitted by native FormData, so we must exclude them too
    const allCheckboxes = form.querySelectorAll('input[type="checkbox"]:not(:disabled)');
    const checkboxesByName = new Map();
    for (const checkbox of Array.from(allCheckboxes)) {
        const input = checkbox;
        const name = input.name;
        if (!name)
            continue; // Skip unnamed checkboxes
        if (!checkboxesByName.has(name)) {
            checkboxesByName.set(name, []);
        }
        checkboxesByName.get(name).push(input);
    }
    // Step 2: Identify enabled select[multiple] fields
    // Disabled selects are omitted by native FormData, so we must exclude them too
    const allSelectMultiple = form.querySelectorAll('select[multiple]:not(:disabled)');
    const selectMultipleNames = new Set();
    for (const select of Array.from(allSelectMultiple)) {
        const name = select.name;
        if (name)
            selectMultipleNames.add(name);
    }
    // Step 3: Process all FormData entries (use getAll to handle multi-value fields)
    const processedNames = new Set();
    // Get unique field names from FormData
    const fieldNames = new Set();
    for (const [name] of fd.entries()) {
        fieldNames.add(name);
    }
    for (const name of fieldNames) {
        // Skip checkboxes (handled separately in Step 4)
        if (checkboxesByName.has(name)) {
            continue;
        }
        processedNames.add(name);
        const element = form.elements.namedItem(name);
        // Handle select[multiple] - always use getAll
        if (selectMultipleNames.has(name)) {
            const values = fd.getAll(name);
            setNestedValue(result, name, values);
            continue;
        }
        // Get all values for this name
        const allValues = fd.getAll(name);
        // If multiple values exist (e.g., repeated inputs), use array
        if (allValues.length > 1) {
            setNestedValue(result, name, allValues);
            continue;
        }
        // Single value processing
        const value = allValues[0];
        let finalValue = value;
        if (element && 'type' in element) {
            const input = element;
            if (input.type === 'file') {
                finalValue = value; // File object
            }
            else if (input.type === 'number') {
                const num = parseFloat(value);
                finalValue = isNaN(num) ? value : num;
            }
            else if (input.type === 'radio') {
                finalValue = value;
            }
        }
        setNestedValue(result, name, finalValue);
    }
    // Step 4: Handle all checkbox fields (including unchecked ones)
    for (const [name, checkboxes] of checkboxesByName) {
        const isSingleCheckbox = checkboxes.length === 1;
        const checkedValues = fd.getAll(name);
        if (isSingleCheckbox) {
            // Single checkbox → boolean
            // checked → true, unchecked → false
            setNestedValue(result, name, checkedValues.length > 0);
        }
        else {
            // Multiple checkboxes → always array
            // checked → array of values, none checked → []
            setNestedValue(result, name, checkedValues);
        }
        processedNames.add(name);
    }
    // Step 5: Handle select[multiple] with no selection (not in FormData)
    for (const name of selectMultipleNames) {
        if (!processedNames.has(name)) {
            // No selection → empty array
            setNestedValue(result, name, []);
            processedNames.add(name);
        }
    }
    return result;
}
/**
 * Set a value in a nested object using dot/bracket notation.
 * Examples:
 * - "email" → obj.email
 * - "user.name" → obj.user.name
 * - "phones[0].number" → obj.phones[0].number
 */
function setNestedValue(obj, path, value) {
    const parts = parsePath(path);
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const next = parts[i + 1];
        if (!(part in current)) {
            // Create object or array based on next part
            current[part] = typeof next === 'number' ? [] : {};
        }
        current = current[part];
    }
    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
}
/**
 * Parse a path string into an array of keys/indices.
 * Examples:
 * - "email" → ["email"]
 * - "user.name" → ["user", "name"]
 * - "phones[0].number" → ["phones", 0, "number"]
 */
function parsePath(path) {
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
            // Find closing bracket
            const closeIndex = path.indexOf(']', i);
            if (closeIndex === -1) {
                throw new Error(`Invalid path: missing closing bracket in "${path}"`);
            }
            const index = path.slice(i + 1, closeIndex);
            const parsed = parseInt(index, 10);
            // Numeric index → array access; non-numeric → object key
            parts.push(isNaN(parsed) ? index : parsed);
            i = closeIndex + 1;
            // Skip dot after bracket if present
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
 * Get a nested value from an object using a path.
 */
function getNestedValue(obj, path) {
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
function cssEscape(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) {
        return CSS.escape(value);
    }
    return value.replace(/([^\w-])/g, '\\$1');
}
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
    function validate(data) {
        if (!options.validate)
            return true;
        clearErrors();
        const result = options.validate(data);
        if (!result)
            return true;
        // Check if result is object with fieldErrors/formError
        if (typeof result === 'object' && result !== null) {
            if ('fieldErrors' in result || 'formError' in result) {
                const typedResult = result;
                if (typedResult.fieldErrors) {
                    errors.set(typedResult.fieldErrors);
                }
                if (typedResult.formError) {
                    formErrorSignal.set(typedResult.formError);
                }
                // Check if fieldErrors is empty (not just truthy)
                // Validator can return { fieldErrors: {}, formError: null } which is valid
                const hasFieldErrors = typedResult.fieldErrors && Object.keys(typedResult.fieldErrors).length > 0;
                const hasFormError = typedResult.formError && typedResult.formError.length > 0;
                return !hasFieldErrors && !hasFormError;
            }
            else {
                // Assume it's FieldErrors
                const fieldErrors = result;
                errors.set(fieldErrors);
                return Object.keys(fieldErrors).length === 0;
            }
        }
        return true;
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
                validate(data);
            }
        };
        element.addEventListener('blur', handleBlur);
        // Setup change handler for dirty + validation
        const handleChange = () => {
            if (!defaultsInitialized)
                return;
            // Use dynamic path lookup instead of captured path
            const currentPath = getCurrentPath();
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
                validate(data);
            }
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
                const isValid = validate(data);
                if (!isValid) {
                    focus(); // Focus first error
                    return;
                }
                // Call handler
                await handler(data, { signal });
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
    // Focus Management
    // Find element by current DOM path instead of stale registry
    // After d-array reorders, data-field-path is updated but registry has old keys
    function findFieldElement(path) {
        if (!formElement)
            return null;
        const escapePath = cssEscape(path);
        // Prioritize [d-field] to avoid matching hidden inputs
        // Try data-field-path first (set by d-array), then name attribute
        return formElement.querySelector(`[d-field][data-field-path="${escapePath}"], [d-field][name="${escapePath}"]`);
    }
    function focus(path) {
        if (path) {
            const el = findFieldElement(path);
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
        const el = findFieldElement(firstErrorPath);
        if (el && 'focus' in el) {
            el.focus();
        }
    }
    // Reset
    function reset(nextDefaults) {
        if (nextDefaults !== undefined) {
            defaultValues = nextDefaults;
        }
        // Reset form element
        if (formElement) {
            formElement.reset();
            // Find fields by DOM query instead of stale registry
            // After d-array reorders, data-field-path reflects current indices
            const allFields = formElement.querySelectorAll('[d-field]');
            for (const el of allFields) {
                // Get current path from DOM (handles reordered arrays)
                const fieldPath = el.getAttribute('data-field-path') || el.getAttribute('name');
                if (!fieldPath)
                    continue;
                const defaultValue = getNestedValue(defaultValues, fieldPath);
                const input = el;
                if (defaultValue !== undefined) {
                    if (input.type === 'checkbox') {
                        // Respect checkbox contract (single = boolean, multiple = array)
                        if (Array.isArray(defaultValue)) {
                            // Multiple checkboxes: check if value is in array
                            input.checked = defaultValue.includes(input.value);
                        }
                        else {
                            // Single checkbox: use boolean value
                            input.checked = !!defaultValue;
                        }
                    }
                    else if (input.type === 'radio') {
                        input.checked = input.value === String(defaultValue);
                    }
                    else if (input.tagName === 'SELECT') {
                        const select = el;
                        if (select.multiple && Array.isArray(defaultValue)) {
                            // Handle select multiple
                            for (const option of Array.from(select.options)) {
                                option.selected = defaultValue.includes(option.value);
                            }
                        }
                        else {
                            select.value = String(defaultValue);
                        }
                    }
                    else {
                        input.value = String(defaultValue);
                    }
                }
            }
        }
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
            // Pass meta-state signals for remapping on reorder
            errors,
            touchedSet,
            dirtySet,
        });
        // Initialize from defaultValues if available
        // When d-array is first rendered, it should start with values from defaultValues
        if (defaultsInitialized) {
            const initialValue = getNestedValue(defaultValues, path);
            if (Array.isArray(initialValue)) {
                array.replace(initialValue);
            }
        }
        fieldArrayRegistry.set(path, array);
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
    }
    // Cleanup on scope disposal
    if (scope) {
        scope.onCleanup(() => {
            submitController?.abort();
            fieldRegistry.clear();
            fieldArrayRegistry.clear();
        });
    }
    return {
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
        _registerField,
        _getFormElement,
        _setFormElement,
        fieldArray,
    };
}
function createFieldArray(basePath, options) {
    const keys = signal([]);
    const values = signal(new Map());
    let keyCounter = 0;
    function generateKey() {
        return `${basePath}_${keyCounter++}`;
    }
    // Helper to remap meta-state paths when array order changes
    function remapMetaState(oldIndices, newIndices) {
        if (!options.errors && !options.touchedSet && !options.dirtySet)
            return;
        // Build index mapping: oldIndex -> newIndex
        const indexMap = new Map();
        for (let i = 0; i < oldIndices.length; i++) {
            indexMap.set(oldIndices[i], newIndices[i]);
        }
        // Remap errors
        if (options.errors) {
            options.errors.update((prev) => {
                const next = {};
                for (const [path, message] of Object.entries(prev)) {
                    const newPath = remapPath(path, indexMap);
                    next[newPath] = message;
                }
                return next;
            });
        }
        // Remap touched
        if (options.touchedSet) {
            options.touchedSet.update((prev) => {
                const next = new Set();
                for (const path of prev) {
                    next.add(remapPath(path, indexMap));
                }
                return next;
            });
        }
        // Remap dirty
        if (options.dirtySet) {
            options.dirtySet.update((prev) => {
                const next = new Set();
                for (const path of prev) {
                    next.add(remapPath(path, indexMap));
                }
                return next;
            });
        }
    }
    function remapPath(path, indexMap) {
        // Match paths like "basePath[index].field" or "basePath[index]"
        const regex = new RegExp(`^${escapeRegExp(basePath)}\\[(\\d+)\\](.*)$`);
        const match = path.match(regex);
        if (!match)
            return path;
        const oldIndex = parseInt(match[1], 10);
        const rest = match[2];
        const newIndex = indexMap.get(oldIndex);
        if (newIndex === undefined)
            return path;
        return `${basePath}[${newIndex}]${rest}`;
    }
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    // Accessors
    function fields() {
        const currentKeys = keys();
        const currentValues = values();
        return currentKeys.map((key) => ({
            key,
            value: currentValues.get(key),
        }));
    }
    function length() {
        return keys().length;
    }
    function _getIndex(key) {
        return keys().indexOf(key);
    }
    function _translatePath(path) {
        // Translate index-based path to key-based path
        // Example: "phones[0].number" → "phones:key123.number"
        const match = path.match(/^([^\[]+)\[(\d+)\](.*)$/);
        if (!match)
            return null;
        const [, arrayPath, indexStr, rest] = match;
        if (arrayPath !== basePath)
            return null;
        const index = parseInt(indexStr, 10);
        const currentKeys = keys();
        const key = currentKeys[index];
        if (!key)
            return null;
        return `${arrayPath}:${key}${rest}`;
    }
    // Mutations
    function append(value) {
        const items = Array.isArray(value) ? value : [value];
        const newKeys = items.map(() => generateKey());
        keys.update((prev) => [...prev, ...newKeys]);
        values.update((prev) => {
            const next = new Map(prev);
            newKeys.forEach((key, i) => next.set(key, items[i]));
            return next;
        });
    }
    function remove(key) {
        const removeIndex = _getIndex(key);
        const currentLength = keys().length;
        keys.update((prev) => prev.filter((k) => k !== key));
        values.update((prev) => {
            const next = new Map(prev);
            next.delete(key);
            return next;
        });
        // Clear meta-state for the removed index, then remap remaining indices
        // to keep errors/touched/dirty aligned with current rows.
        if (removeIndex >= 0) {
            const prefix = `${basePath}[${removeIndex}]`;
            // Clear errors for removed item
            if (options.errors) {
                options.errors.update((prev) => {
                    const next = {};
                    for (const [path, message] of Object.entries(prev)) {
                        if (!path.startsWith(prefix)) {
                            next[path] = message;
                        }
                    }
                    return next;
                });
            }
            // Clear touched for removed item
            if (options.touchedSet) {
                options.touchedSet.update((prev) => {
                    const next = new Set();
                    for (const path of prev) {
                        if (!path.startsWith(prefix)) {
                            next.add(path);
                        }
                    }
                    return next;
                });
            }
            // Clear dirty for removed item
            if (options.dirtySet) {
                options.dirtySet.update((prev) => {
                    const next = new Set();
                    for (const path of prev) {
                        if (!path.startsWith(prefix)) {
                            next.add(path);
                        }
                    }
                    return next;
                });
            }
            // Remap indices after removed item (shift down)
            const oldIndices = [];
            const newIndices = [];
            for (let i = removeIndex + 1; i < currentLength; i++) {
                oldIndices.push(i);
                newIndices.push(i - 1);
            }
            if (oldIndices.length > 0) {
                remapMetaState(oldIndices, newIndices);
            }
        }
    }
    function removeAt(index) {
        if (index < 0 || index >= keys().length)
            return;
        const key = keys()[index];
        if (key)
            remove(key);
    }
    function insert(index, value) {
        const len = keys().length;
        if (index < 0 || index > len)
            return;
        const key = generateKey();
        const currentLength = len;
        // Remap meta-state so indices at and after insert point shift up
        const oldIndices = [];
        const newIndices = [];
        for (let i = index; i < currentLength; i++) {
            oldIndices.push(i);
            newIndices.push(i + 1);
        }
        if (oldIndices.length > 0) {
            remapMetaState(oldIndices, newIndices);
        }
        keys.update((prev) => {
            const next = [...prev];
            next.splice(index, 0, key);
            return next;
        });
        values.update((prev) => {
            const next = new Map(prev);
            next.set(key, value);
            return next;
        });
    }
    function move(fromIndex, toIndex) {
        const len = keys().length;
        if (fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len)
            return;
        if (fromIndex === toIndex)
            return;
        // Build index remapping for meta-state
        const oldIndices = [];
        const newIndices = [];
        if (fromIndex < toIndex) {
            // Moving forward: items between shift down
            oldIndices.push(fromIndex);
            newIndices.push(toIndex);
            for (let i = fromIndex + 1; i <= toIndex; i++) {
                oldIndices.push(i);
                newIndices.push(i - 1);
            }
        }
        else {
            // Moving backward: items between shift up
            oldIndices.push(fromIndex);
            newIndices.push(toIndex);
            for (let i = toIndex; i < fromIndex; i++) {
                oldIndices.push(i);
                newIndices.push(i + 1);
            }
        }
        remapMetaState(oldIndices, newIndices);
        keys.update((prev) => {
            const next = [...prev];
            const [item] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, item);
            return next;
        });
    }
    function swap(indexA, indexB) {
        const len = keys().length;
        if (indexA < 0 || indexA >= len || indexB < 0 || indexB >= len)
            return;
        if (indexA === indexB)
            return;
        // Remap meta-state for swap
        remapMetaState([indexA, indexB], [indexB, indexA]);
        keys.update((prev) => {
            const next = [...prev];
            [next[indexA], next[indexB]] = [next[indexB], next[indexA]];
            return next;
        });
    }
    function replace(newValues) {
        const newKeys = newValues.map(() => generateKey());
        // Clear all meta-state for this array (full replacement)
        if (options.errors) {
            options.errors.update((prev) => {
                const next = {};
                for (const [path, message] of Object.entries(prev)) {
                    if (!path.startsWith(`${basePath}[`)) {
                        next[path] = message;
                    }
                }
                return next;
            });
        }
        if (options.touchedSet) {
            options.touchedSet.update((prev) => {
                const next = new Set();
                for (const path of prev) {
                    if (!path.startsWith(`${basePath}[`)) {
                        next.add(path);
                    }
                }
                return next;
            });
        }
        if (options.dirtySet) {
            options.dirtySet.update((prev) => {
                const next = new Set();
                for (const path of prev) {
                    if (!path.startsWith(`${basePath}[`)) {
                        next.add(path);
                    }
                }
                return next;
            });
        }
        keys.set(newKeys);
        values.set(new Map(newKeys.map((key, i) => [key, newValues[i]])));
    }
    function update(key, value) {
        values.update((prev) => {
            const next = new Map(prev);
            next.set(key, value);
            return next;
        });
    }
    function updateAt(index, value) {
        if (index < 0 || index >= keys().length)
            return;
        const key = keys()[index];
        if (key)
            update(key, value);
    }
    function clear() {
        // Clear meta-state to prevent stale errors/touched/dirty
        // on new items appended after clear(). Delegate to replace([])
        // which already handles full meta-state cleanup.
        replace([]);
    }
    // Cleanup
    if (options.scope) {
        options.scope.onCleanup(() => {
            clear();
        });
    }
    return {
        fields,
        append,
        remove,
        removeAt,
        insert,
        move,
        swap,
        replace,
        update,
        updateAt,
        clear,
        length,
        _getIndex,
        _translatePath,
    };
}
