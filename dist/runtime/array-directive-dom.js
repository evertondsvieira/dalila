export function queryAllElements(root, selector) {
    return Array.from(root.querySelectorAll(selector));
}
export function queryIncludingRoot(root, attrName) {
    const selector = `[${attrName}]`;
    const out = [];
    if (root.hasAttribute(attrName))
        out.push(root);
    out.push(...queryAllElements(root, selector));
    return out;
}
export function updateNestedArrayDataPaths(root, arrayPath, index) {
    if (!arrayPath)
        return;
    for (const nestedArr of queryAllElements(root, '[d-array]')) {
        const relativeArrayPath = nestedArr.getAttribute('d-array');
        if (!relativeArrayPath)
            continue;
        nestedArr.setAttribute('data-array-path', `${arrayPath}[${index}].${relativeArrayPath}`);
    }
}
export function ensureButtonTypeForSelector(root, selector) {
    for (const btn of queryAllElements(root, selector)) {
        if (btn.tagName !== 'BUTTON')
            continue;
        if (btn.getAttribute('type') !== 'button') {
            btn.setAttribute('type', 'button');
        }
    }
}
