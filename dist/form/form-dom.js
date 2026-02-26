import { cssEscape, getNestedValue } from './path-utils.js';
export function findFormFieldElement(formElement, path) {
    if (!formElement)
        return null;
    const escapedPath = cssEscape(path);
    return formElement.querySelector(`[d-field][data-field-path="${escapedPath}"], [d-field][name="${escapedPath}"]`);
}
/**
 * Reset all `[d-field]` DOM controls to the provided defaults.
 * Keeps field arrays and meta-state handling to the caller.
 */
export function resetFormDomFields(formElement, defaultValues) {
    if (!formElement)
        return;
    formElement.reset();
    const allFields = formElement.querySelectorAll('[d-field]');
    for (const el of Array.from(allFields)) {
        const fieldPath = el.getAttribute('data-field-path') || el.getAttribute('name');
        if (!fieldPath)
            continue;
        const defaultValue = getNestedValue(defaultValues, fieldPath);
        const input = el;
        if (defaultValue === undefined)
            continue;
        if (input.type === 'checkbox') {
            if (Array.isArray(defaultValue)) {
                input.checked = defaultValue.includes(input.value);
            }
            else {
                input.checked = !!defaultValue;
            }
            continue;
        }
        if (input.type === 'radio') {
            input.checked = input.value === String(defaultValue);
            continue;
        }
        if (input.tagName === 'SELECT') {
            const select = el;
            if (select.multiple && Array.isArray(defaultValue)) {
                for (const option of Array.from(select.options)) {
                    option.selected = defaultValue.includes(option.value);
                }
            }
            else {
                select.value = String(defaultValue);
            }
            continue;
        }
        input.value = String(defaultValue);
    }
}
