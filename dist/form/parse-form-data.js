import { setNestedValue } from './path-utils.js';
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
export function parseFormData(form, fd) {
    const result = {};
    const allCheckboxes = form.querySelectorAll('input[type="checkbox"]:not(:disabled)');
    const checkboxesByName = new Map();
    for (const checkbox of Array.from(allCheckboxes)) {
        const input = checkbox;
        const name = input.name;
        if (!name)
            continue;
        if (!checkboxesByName.has(name))
            checkboxesByName.set(name, []);
        checkboxesByName.get(name).push(input);
    }
    const allSelectMultiple = form.querySelectorAll('select[multiple]:not(:disabled)');
    const selectMultipleNames = new Set();
    for (const select of Array.from(allSelectMultiple)) {
        const name = select.name;
        if (name)
            selectMultipleNames.add(name);
    }
    const processedNames = new Set();
    const fieldNames = new Set();
    fd.forEach((_value, name) => {
        fieldNames.add(name);
    });
    for (const name of fieldNames) {
        if (checkboxesByName.has(name))
            continue;
        processedNames.add(name);
        const element = form.elements.namedItem(name);
        if (selectMultipleNames.has(name)) {
            setNestedValue(result, name, fd.getAll(name));
            continue;
        }
        const allValues = fd.getAll(name);
        if (allValues.length > 1) {
            setNestedValue(result, name, allValues);
            continue;
        }
        const value = allValues[0];
        let finalValue = value;
        if (element && 'type' in element) {
            const input = element;
            if (input.type === 'file') {
                finalValue = value;
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
    for (const [name, checkboxes] of checkboxesByName) {
        const isSingleCheckbox = checkboxes.length === 1;
        const checkedValues = fd.getAll(name);
        if (isSingleCheckbox) {
            setNestedValue(result, name, checkedValues.length > 0);
        }
        else {
            setNestedValue(result, name, checkedValues);
        }
        processedNames.add(name);
    }
    for (const name of selectMultipleNames) {
        if (!processedNames.has(name)) {
            setNestedValue(result, name, []);
            processedNames.add(name);
        }
    }
    return result;
}
