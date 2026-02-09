/**
 * Dalila Template Runtime - bind()
 *
 * Binds a DOM tree to a reactive context using declarative attributes.
 * No eval, no inline JS execution - only identifier resolution from ctx.
 *
 * @module dalila/runtime
 */
import { effect, createScope, withScope, isInDevMode, signal } from '../core/index.js';
import { WRAPPED_HANDLER } from '../form/index.js';
// ============================================================================
// Utilities
// ============================================================================
/**
 * Check if a value is a Dalila signal
 */
function isSignal(value) {
    return typeof value === 'function' && 'set' in value && 'update' in value;
}
/**
 * Resolve a value from ctx - handles signals, functions, and plain values.
 * Only zero-arity functions are called (getters/computed).  Functions with
 * parameters are almost certainly event handlers and must never be invoked
 * here — doing so would trigger side-effects silently.
 */
function resolve(value) {
    if (isSignal(value))
        return value();
    if (typeof value === 'function') {
        const fn = value;
        if (fn.length === 0)
            return fn();
        warn(`resolve(): "${fn.name || 'anonymous'}" has parameters — not executed. Use a signal or a zero-arity getter.`);
        return undefined;
    }
    return value;
}
/**
 * Normalize binding attribute value
 * Attributes use plain identifiers only (e.g. "count")
 */
function normalizeBinding(raw) {
    if (!raw)
        return null;
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const braced = trimmed.match(/^\{\s*([a-zA-Z_$][\w$]*)\s*\}$/);
    if (braced) {
        warn(`Attribute bindings must use plain identifiers (no braces). Use "${braced[1]}" instead of "${trimmed}".`);
        return null;
    }
    return trimmed;
}
/**
 * querySelectorAll that also tests the root element itself.
 * Necessary because querySelectorAll only searches descendants.
 */
function qsaIncludingRoot(root, selector) {
    const out = [];
    if (root.matches(selector))
        out.push(root);
    out.push(...Array.from(root.querySelectorAll(selector)));
    // Determine the "boundary" — the nearest already-bound ancestor of root
    // (or root itself when it carries the marker).  Only elements whose own
    // nearest bound ancestor matches this boundary belong to the current bind
    // scope; anything deeper was already bound by a nested bind() call.
    // This also handles manual bind() calls on elements inside a clone:
    // root won't have the marker, but root.closest() will find the clone.
    const boundary = root.closest('[data-dalila-internal-bound]');
    return out.filter(el => {
        const bound = el.closest('[data-dalila-internal-bound]');
        return bound === boundary;
    });
}
/**
 * Dev mode warning helper
 */
function warn(message) {
    if (isInDevMode()) {
        console.warn(`[Dalila] ${message}`);
    }
}
// ============================================================================
// Default Options
// ============================================================================
const DEFAULT_EVENTS = ['click', 'input', 'change', 'submit', 'keydown', 'keyup'];
const DEFAULT_RAW_TEXT_SELECTORS = 'pre, code';
// ============================================================================
// Text Interpolation
// ============================================================================
/**
 * Process a text node and replace {tokens} with reactive bindings
 */
function bindTextNode(node, ctx, cleanups) {
    const text = node.data;
    const regex = /\{\s*([a-zA-Z_$][\w$]*)\s*\}/g;
    // Check if there are any tokens
    if (!regex.test(text))
        return;
    // Reset regex
    regex.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
        // Add text before the token
        const before = text.slice(cursor, match.index);
        if (before) {
            frag.appendChild(document.createTextNode(before));
        }
        const key = match[1];
        const value = ctx[key];
        if (value === undefined) {
            warn(`Text interpolation: "${key}" not found in context`);
            frag.appendChild(document.createTextNode(match[0]));
        }
        else if (isSignal(value) || (typeof value === 'function' && value.length === 0)) {
            // Signal or zero-arity getter — reactive text node.
            // resolve() inside the effect calls the value and tracks dependencies.
            const textNode = document.createTextNode('');
            effect(() => {
                const v = resolve(value);
                textNode.data = v == null ? '' : String(v);
            });
            frag.appendChild(textNode);
        }
        else {
            // Static value — or a function with params, in which case resolve()
            // warns and returns undefined, normalised to empty string below.
            const resolved = resolve(value);
            frag.appendChild(document.createTextNode(resolved == null ? '' : String(resolved)));
        }
        cursor = match.index + match[0].length;
    }
    // Add remaining text
    const after = text.slice(cursor);
    if (after) {
        frag.appendChild(document.createTextNode(after));
    }
    // Replace original node
    if (node.parentNode) {
        node.parentNode.replaceChild(frag, node);
    }
}
// ============================================================================
// Event Binding
// ============================================================================
/**
 * Bind all d-on-* events within root
 */
function bindEvents(root, ctx, events, cleanups) {
    for (const eventName of events) {
        const attr = `d-on-${eventName}`;
        const elements = qsaIncludingRoot(root, `[${attr}]`);
        for (const el of elements) {
            const handlerName = normalizeBinding(el.getAttribute(attr));
            if (!handlerName)
                continue;
            const handler = ctx[handlerName];
            if (handler === undefined) {
                warn(`Event handler "${handlerName}" not found in context`);
                continue;
            }
            if (typeof handler !== 'function') {
                warn(`Event handler "${handlerName}" is not a function`);
                continue;
            }
            el.addEventListener(eventName, handler);
            cleanups.push(() => el.removeEventListener(eventName, handler));
        }
    }
}
// ============================================================================
// d-when Directive
// ============================================================================
/**
 * Bind all [d-when] directives within root
 */
function bindWhen(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[when], [d-when]');
    for (const el of elements) {
        const attrName = el.hasAttribute('when') ? 'when' : 'd-when';
        const bindingName = normalizeBinding(el.getAttribute(attrName));
        if (!bindingName)
            continue;
        const binding = ctx[bindingName];
        if (binding === undefined) {
            warn(`when: "${bindingName}" not found in context`);
            continue;
        }
        const htmlEl = el;
        // Apply initial state synchronously to avoid FOUC (flash of unstyled content)
        const initialValue = !!resolve(binding);
        htmlEl.style.display = initialValue ? '' : 'none';
        // Then create reactive effect to keep it updated
        effect(() => {
            const value = !!resolve(binding);
            htmlEl.style.display = value ? '' : 'none';
        });
    }
}
// ============================================================================
// d-match Directive
// ============================================================================
/**
 * Bind all [d-match] directives within root
 */
function bindMatch(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-match]');
    for (const el of elements) {
        const bindingName = normalizeBinding(el.getAttribute('d-match'));
        if (!bindingName)
            continue;
        const binding = ctx[bindingName];
        if (binding === undefined) {
            warn(`d-match: "${bindingName}" not found in context`);
            continue;
        }
        // Apply initial state synchronously to avoid FOUC
        const applyMatch = () => {
            const cases = Array.from(el.querySelectorAll('[case]'));
            const v = resolve(binding);
            const value = v == null ? '' : String(v);
            let matchedEl = null;
            let defaultEl = null;
            // First pass: hide all and find match/default
            for (const caseEl of cases) {
                caseEl.style.display = 'none';
                const caseValue = caseEl.getAttribute('case');
                if (caseValue === 'default') {
                    defaultEl = caseEl;
                }
                else if (caseValue === value && !matchedEl) {
                    matchedEl = caseEl;
                }
            }
            // Second pass: show match OR default (not both)
            if (matchedEl) {
                matchedEl.style.display = '';
            }
            else if (defaultEl) {
                defaultEl.style.display = '';
            }
        };
        // Apply initial state
        applyMatch();
        // Then create reactive effect to keep it updated
        effect(() => {
            applyMatch();
        });
    }
}
// ============================================================================
// d-each Directive
// ============================================================================
/**
 * Bind all [d-each] directives within root.
 * The element with d-each is used as a template: removed from DOM and cloned
 * once per item in the array. Each clone is independently bound with the
 * item's properties as its context.
 */
function bindEach(root, ctx, cleanups) {
    // Only bind top-level d-each elements.  Nested d-each (inside another
    // d-each template) must be left untouched here — they will be bound when
    // their parent clones are passed to bind() individually.
    const elements = qsaIncludingRoot(root, '[d-each]')
        .filter(el => !el.parentElement?.closest('[d-each]'));
    for (const el of elements) {
        const bindingName = normalizeBinding(el.getAttribute('d-each'));
        if (!bindingName)
            continue;
        const binding = ctx[bindingName];
        if (binding === undefined) {
            warn(`d-each: "${bindingName}" not found in context`);
            continue;
        }
        const comment = document.createComment('d-each');
        el.parentNode?.replaceChild(comment, el);
        el.removeAttribute('d-each');
        const keyBinding = normalizeBinding(el.getAttribute('d-key'));
        el.removeAttribute('d-key');
        const template = el;
        const clonesByKey = new Map();
        const disposesByKey = new Map();
        const metadataByKey = new Map();
        const itemsByKey = new Map();
        const objectKeyIds = new WeakMap();
        const symbolKeyIds = new Map();
        let nextObjectKeyId = 0;
        let nextSymbolKeyId = 0;
        const missingKeyWarned = new Set();
        const getObjectKeyId = (value) => {
            const existing = objectKeyIds.get(value);
            if (existing !== undefined)
                return existing;
            const next = ++nextObjectKeyId;
            objectKeyIds.set(value, next);
            return next;
        };
        const keyValueToString = (value, index) => {
            if (value === null || value === undefined)
                return `idx:${index}`;
            const type = typeof value;
            if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
                return `${type}:${String(value)}`;
            }
            if (type === 'symbol') {
                const sym = value;
                let id = symbolKeyIds.get(sym);
                if (id === undefined) {
                    id = ++nextSymbolKeyId;
                    symbolKeyIds.set(sym, id);
                }
                return `sym:${id}`;
            }
            if (type === 'object' || type === 'function') {
                return `obj:${getObjectKeyId(value)}`;
            }
            return `idx:${index}`;
        };
        const readKeyValue = (item, index) => {
            if (keyBinding) {
                if (keyBinding === '$index')
                    return index;
                if (keyBinding === 'item')
                    return item;
                if (typeof item === 'object' && item !== null && keyBinding in item) {
                    return item[keyBinding];
                }
                const warnId = `${keyBinding}:${index}`;
                if (!missingKeyWarned.has(warnId)) {
                    warn(`d-each: key "${keyBinding}" not found on item at index ${index}. Falling back to index key.`);
                    missingKeyWarned.add(warnId);
                }
                return index;
            }
            if (typeof item === 'object' && item !== null) {
                const obj = item;
                if ('id' in obj)
                    return obj.id;
                if ('key' in obj)
                    return obj.key;
            }
            return index;
        };
        function createClone(key, item, index, count) {
            const clone = template.cloneNode(true);
            // Inherit parent ctx via prototype so values and handlers defined
            // outside the loop remain accessible inside each iteration.
            const itemCtx = Object.create(ctx);
            if (typeof item === 'object' && item !== null) {
                Object.assign(itemCtx, item);
            }
            const metadata = {
                $index: signal(index),
                $count: signal(count),
                $first: signal(index === 0),
                $last: signal(index === count - 1),
                $odd: signal(index % 2 !== 0),
                $even: signal(index % 2 === 0),
            };
            metadataByKey.set(key, metadata);
            itemsByKey.set(key, item);
            // Expose item + positional / collection helpers.
            itemCtx.item = item;
            itemCtx.key = key;
            itemCtx.$index = metadata.$index;
            itemCtx.$count = metadata.$count;
            itemCtx.$first = metadata.$first;
            itemCtx.$last = metadata.$last;
            itemCtx.$odd = metadata.$odd;
            itemCtx.$even = metadata.$even;
            // Mark BEFORE bind() so the parent's subsequent global passes
            // (text, attrs, events …) skip this subtree entirely.
            clone.setAttribute('data-dalila-internal-bound', '');
            const dispose = bind(clone, itemCtx, { _skipLifecycle: true });
            disposesByKey.set(key, dispose);
            clonesByKey.set(key, clone);
            return clone;
        }
        function updateCloneMetadata(key, index, count) {
            const metadata = metadataByKey.get(key);
            if (metadata) {
                metadata.$index.set(index);
                metadata.$count.set(count);
                metadata.$first.set(index === 0);
                metadata.$last.set(index === count - 1);
                metadata.$odd.set(index % 2 !== 0);
                metadata.$even.set(index % 2 === 0);
            }
        }
        function renderList(items) {
            const orderedClones = [];
            const orderedKeys = [];
            const nextKeys = new Set();
            const changedKeys = new Set();
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                let key = keyValueToString(readKeyValue(item, i), i);
                if (nextKeys.has(key)) {
                    warn(`d-each: duplicate key "${key}" at index ${i}. Falling back to per-index key.`);
                    key = `${key}:dup:${i}`;
                }
                nextKeys.add(key);
                let clone = clonesByKey.get(key);
                if (clone) {
                    updateCloneMetadata(key, i, items.length);
                    if (itemsByKey.get(key) !== item) {
                        changedKeys.add(key);
                    }
                }
                else {
                    clone = createClone(key, item, i, items.length);
                }
                orderedClones.push(clone);
                orderedKeys.push(key);
            }
            for (let i = 0; i < orderedClones.length; i++) {
                const clone = orderedClones[i];
                const item = items[i];
                const key = orderedKeys[i];
                if (!changedKeys.has(key))
                    continue;
                clone.remove();
                const dispose = disposesByKey.get(key);
                if (dispose) {
                    dispose();
                    disposesByKey.delete(key);
                }
                clonesByKey.delete(key);
                metadataByKey.delete(key);
                itemsByKey.delete(key);
                orderedClones[i] = createClone(key, item, i, items.length);
            }
            for (const [key, clone] of clonesByKey) {
                if (nextKeys.has(key))
                    continue;
                clone.remove();
                clonesByKey.delete(key);
                metadataByKey.delete(key);
                itemsByKey.delete(key);
                const dispose = disposesByKey.get(key);
                if (dispose) {
                    dispose();
                    disposesByKey.delete(key);
                }
            }
            const parent = comment.parentNode;
            if (!parent)
                return;
            let referenceNode = comment;
            for (let i = orderedClones.length - 1; i >= 0; i--) {
                const clone = orderedClones[i];
                if (clone.nextSibling !== referenceNode) {
                    parent.insertBefore(clone, referenceNode);
                }
                referenceNode = clone;
            }
        }
        if (isSignal(binding)) {
            // Effect owned by templateScope — no manual stop needed
            effect(() => {
                const value = binding();
                renderList(Array.isArray(value) ? value : []);
            });
        }
        else if (Array.isArray(binding)) {
            renderList(binding);
        }
        else {
            warn(`d-each: "${bindingName}" is not an array or signal`);
        }
        cleanups.push(() => {
            for (const clone of clonesByKey.values())
                clone.remove();
            for (const dispose of disposesByKey.values())
                dispose();
            clonesByKey.clear();
            disposesByKey.clear();
            metadataByKey.clear();
            itemsByKey.clear();
        });
    }
}
// ============================================================================
// d-if Directive
// ============================================================================
/**
 * Bind all [d-if] directives within root.
 * Unlike [d-when] which toggles display, d-if adds/removes the element from
 * the DOM entirely. A comment node is left as placeholder for insertion position.
 */
function bindIf(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-if]');
    for (const el of elements) {
        const bindingName = normalizeBinding(el.getAttribute('d-if'));
        if (!bindingName)
            continue;
        const binding = ctx[bindingName];
        if (binding === undefined) {
            warn(`d-if: "${bindingName}" not found in context`);
            continue;
        }
        const comment = document.createComment('d-if');
        el.parentNode?.replaceChild(comment, el);
        el.removeAttribute('d-if');
        const htmlEl = el;
        // Apply initial state synchronously to avoid FOUC
        const initialValue = !!resolve(binding);
        if (initialValue) {
            comment.parentNode?.insertBefore(htmlEl, comment);
        }
        // Then create reactive effect to keep it updated
        effect(() => {
            const value = !!resolve(binding);
            if (value) {
                if (!htmlEl.parentNode) {
                    comment.parentNode?.insertBefore(htmlEl, comment);
                }
            }
            else {
                if (htmlEl.parentNode) {
                    htmlEl.parentNode.removeChild(htmlEl);
                }
            }
        });
    }
}
// ============================================================================
// d-html Directive
// ============================================================================
/**
 * Bind all [d-html] directives within root.
 * Sets innerHTML instead of textContent — HTML tags in the value are rendered.
 * Counterpart to {placeholder} which always escapes HTML via createTextNode.
 */
function bindHtml(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-html]');
    for (const el of elements) {
        const bindingName = normalizeBinding(el.getAttribute('d-html'));
        if (!bindingName)
            continue;
        const binding = ctx[bindingName];
        if (binding === undefined) {
            warn(`d-html: "${bindingName}" not found in context`);
            continue;
        }
        const htmlEl = el;
        if (isSignal(binding)) {
            effect(() => {
                const v = binding();
                const html = v == null ? '' : String(v);
                if (isInDevMode() && /<script[\s>]|javascript:|onerror\s*=/i.test(html)) {
                    warn(`d-html: potentially unsafe HTML in "${bindingName}". Never use with unsanitized user input.`);
                }
                htmlEl.innerHTML = html;
            });
        }
        else {
            const v = resolve(binding);
            const html = v == null ? '' : String(v);
            if (isInDevMode() && /<script[\s>]|javascript:|onerror\s*=/i.test(html)) {
                warn(`d-html: potentially unsafe HTML in "${bindingName}". Never use with unsanitized user input.`);
            }
            htmlEl.innerHTML = html;
        }
    }
}
// ============================================================================
// d-attr Directive
// ============================================================================
/**
 * Apply an attribute value with correct semantics:
 *   null | undefined | false  →  remove the attribute entirely
 *   true                      →  set as empty string (boolean attribute)
 *   anything else             →  stringify and set
 */
// Properties that must be set as IDL properties rather than attributes.
// setAttribute('checked') / setAttribute('value') do NOT update the live
// state of an input after the user has interacted with it.
const BOOLEAN_PROPS = new Set(['checked', 'selected', 'disabled', 'indeterminate']);
const STRING_PROPS = new Set(['value']);
function applyAttr(el, attrName, value) {
    // Fast-path: known IDL properties set as properties on the element
    if (BOOLEAN_PROPS.has(attrName) && attrName in el) {
        el[attrName] = !!value;
        return;
    }
    if (STRING_PROPS.has(attrName) && attrName in el) {
        el[attrName] = value == null ? '' : String(value);
        return;
    }
    // Generic attribute path
    if (value === null || value === undefined || value === false) {
        el.removeAttribute(attrName);
    }
    else if (value === true) {
        el.setAttribute(attrName, '');
    }
    else {
        el.setAttribute(attrName, String(value));
    }
}
function bindAttrs(root, ctx, cleanups) {
    const PREFIX = 'd-attr-';
    const allElements = qsaIncludingRoot(root, '*');
    for (const el of allElements) {
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
            if (!attr.name.startsWith(PREFIX))
                continue;
            const attrName = attr.name.slice(PREFIX.length);
            const bindingName = normalizeBinding(attr.value);
            if (!bindingName)
                continue;
            const binding = ctx[bindingName];
            if (binding === undefined) {
                warn(`d-attr-${attrName}: "${bindingName}" not found in context`);
                continue;
            }
            el.removeAttribute(attr.name);
            if (isSignal(binding)) {
                effect(() => {
                    applyAttr(el, attrName, binding());
                });
            }
            else {
                applyAttr(el, attrName, resolve(binding));
            }
        }
    }
}
// ============================================================================
// Form Directives
// ============================================================================
/**
 * Bind all [d-form] directives within root.
 * Associates a form element with a Form instance from the context.
 * Also auto-wraps d-on-submit handlers through form.handleSubmit().
 */
function bindForm(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-form]');
    for (const el of elements) {
        // Skip forms inside d-each templates
        // They'll be bound when the template is cloned and bound individually
        if (el.closest('[d-each]')) {
            continue;
        }
        if (!(el instanceof HTMLFormElement)) {
            warn('d-form: must be used on a <form> element');
            continue;
        }
        const bindingName = normalizeBinding(el.getAttribute('d-form'));
        if (!bindingName)
            continue;
        const form = ctx[bindingName];
        if (!form || typeof form !== 'object' || !('handleSubmit' in form)) {
            warn(`d-form: "${bindingName}" is not a valid Form instance`);
            continue;
        }
        // Register form element with the Form instance
        if ('_setFormElement' in form && typeof form._setFormElement === 'function') {
            form._setFormElement(el);
        }
        // Auto-wrap d-on-submit handler through form.handleSubmit()
        // Don't mutate shared ctx - add listener directly to this form element
        const submitHandlerName = normalizeBinding(el.getAttribute('d-on-submit'));
        if (submitHandlerName) {
            const originalHandler = ctx[submitHandlerName];
            if (typeof originalHandler === 'function') {
                // Check if handler is already wrapped to avoid double-wrapping
                // If user did: const save = form.handleSubmit(...), don't wrap again
                const isAlreadyWrapped = originalHandler[WRAPPED_HANDLER] === true;
                const finalHandler = isAlreadyWrapped
                    ? originalHandler
                    : form.handleSubmit(originalHandler);
                // Add submit listener directly to form element (not via d-on-submit)
                // This avoids mutating the shared context
                el.addEventListener('submit', finalHandler);
                // Remove d-on-submit to prevent bindEvents from adding duplicate listener
                el.removeAttribute('d-on-submit');
                // Restore attribute on cleanup so dispose()+bind() (HMR) can rediscover it
                cleanups.push(() => {
                    el.removeEventListener('submit', finalHandler);
                    el.setAttribute('d-on-submit', submitHandlerName);
                });
            }
        }
    }
}
/**
 * Bind all [d-field] directives within root.
 * Registers field elements with their Form instance and sets up a11y attributes.
 */
function bindField(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-field]');
    for (const el of elements) {
        // Prefer data-field-path (set by d-array) over d-field for full path
        const dataFieldPath = el.getAttribute('data-field-path');
        const dFieldPath = normalizeBinding(el.getAttribute('d-field'));
        const fieldPath = dataFieldPath || dFieldPath;
        if (!fieldPath)
            continue;
        // Find the form element - use context first (for detached clones), then closest()
        // When bind() runs on d-array clones, the clone is still detached from DOM,
        // so el.closest('form[d-form]') returns null. We pass form refs through context.
        const formEl = ctx._formElement || el.closest('form[d-form]');
        if (!formEl) {
            warn(`d-field: field "${fieldPath}" must be inside a [d-form]`);
            continue;
        }
        const formBinding = ctx._formBinding || normalizeBinding(formEl.getAttribute('d-form'));
        if (!formBinding)
            continue;
        const form = ctx[formBinding];
        if (!form || typeof form !== 'object')
            continue;
        const htmlEl = el;
        // Set name attribute if not already set (use full path)
        if (!htmlEl.getAttribute('name')) {
            htmlEl.setAttribute('name', fieldPath);
        }
        // Register field with form using full path
        if ('_registerField' in form && typeof form._registerField === 'function') {
            const unregister = form._registerField(fieldPath, htmlEl);
            cleanups.push(unregister);
        }
        // Setup reactive aria-invalid based on error state
        if ('error' in form && typeof form.error === 'function') {
            effect(() => {
                // Read current path from DOM attribute inside effect
                // This allows the effect to see updated paths after array reorder
                const currentPath = htmlEl.getAttribute('data-field-path') || htmlEl.getAttribute('name') || fieldPath;
                const errorMsg = form.error(currentPath);
                if (errorMsg) {
                    htmlEl.setAttribute('aria-invalid', 'true');
                    // Use form prefix for unique IDs across multiple forms
                    const errorId = `${formBinding}_${currentPath.replace(/[.\[\]]/g, '_')}_error`;
                    htmlEl.setAttribute('aria-describedby', errorId);
                }
                else {
                    htmlEl.removeAttribute('aria-invalid');
                    htmlEl.removeAttribute('aria-describedby');
                }
            });
        }
    }
}
/**
 * Bind all [d-error] directives within root.
 * Displays error messages for specific fields.
 */
function bindError(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-error]');
    for (const el of elements) {
        // Prefer data-error-path (set by d-array) over d-error for full path
        const dataErrorPath = el.getAttribute('data-error-path');
        const dErrorPath = normalizeBinding(el.getAttribute('d-error'));
        const fieldPath = dataErrorPath || dErrorPath;
        if (!fieldPath)
            continue;
        // Find the form element - use context first (for detached clones), then closest()
        // When bind() runs on d-array clones, the clone is still detached from DOM,
        // so el.closest('form[d-form]') returns null. We pass form refs through context.
        const formEl = ctx._formElement || el.closest('form[d-form]');
        if (!formEl) {
            warn(`d-error: error for "${fieldPath}" must be inside a [d-form]`);
            continue;
        }
        const formBinding = ctx._formBinding || normalizeBinding(formEl.getAttribute('d-form'));
        if (!formBinding)
            continue;
        const form = ctx[formBinding];
        if (!form || typeof form !== 'object' || !('error' in form))
            continue;
        const htmlEl = el;
        // Generate stable ID with form prefix to avoid duplicate IDs
        // Multiple forms on same page can have fields with same names
        const errorId = `${formBinding}_${fieldPath.replace(/[.\[\]]/g, '_')}_error`;
        htmlEl.id = errorId;
        // Set role for accessibility
        htmlEl.setAttribute('role', 'alert');
        htmlEl.setAttribute('aria-live', 'polite');
        // Reactive error display
        effect(() => {
            // Read current path from DOM attribute inside effect
            // This allows the effect to see updated paths after array reorder
            const currentPath = htmlEl.getAttribute('data-error-path') || fieldPath;
            const errorMsg = form.error(currentPath);
            if (errorMsg) {
                // Update ID to match current path (with form prefix for uniqueness)
                const errorId = `${formBinding}_${currentPath.replace(/[.\[\]]/g, '_')}_error`;
                htmlEl.id = errorId;
                htmlEl.textContent = errorMsg;
                htmlEl.style.display = '';
            }
            else {
                htmlEl.textContent = '';
                htmlEl.style.display = 'none';
            }
        });
    }
}
/**
 * Bind all [d-form-error] directives within root.
 * Displays form-level error messages.
 */
function bindFormError(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-form-error]');
    for (const el of elements) {
        // Use the attribute value as explicit form binding name when provided
        const explicitBinding = normalizeBinding(el.getAttribute('d-form-error'));
        // Fall back to finding the form element via context or closest()
        const formEl = ctx._formElement || el.closest('form[d-form]');
        const formBinding = explicitBinding
            || ctx._formBinding
            || (formEl ? normalizeBinding(formEl.getAttribute('d-form')) : null);
        if (!formBinding) {
            warn('d-form-error: must specify a form binding or be inside a [d-form]');
            continue;
        }
        const form = ctx[formBinding];
        if (!form || typeof form !== 'object' || !('formError' in form))
            continue;
        const htmlEl = el;
        // Set role for accessibility
        htmlEl.setAttribute('role', 'alert');
        htmlEl.setAttribute('aria-live', 'polite');
        // Reactive form error display
        effect(() => {
            const errorMsg = form.formError();
            if (errorMsg) {
                htmlEl.textContent = errorMsg;
                htmlEl.style.display = '';
            }
            else {
                htmlEl.textContent = '';
                htmlEl.style.display = 'none';
            }
        });
    }
}
/**
 * Bind all [d-array] directives within root.
 * Renders field arrays with stable keys for reordering.
 * Preserves DOM state by reusing keyed nodes instead of full teardown.
 */
function bindArray(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-array]')
        // Skip d-array inside d-each templates
        // They'll be bound when the template is cloned
        // Note: qsaIncludingRoot's boundary logic already prevents duplicate processing,
        // so we don't need an additional filter for nested d-arrays
        .filter(el => !el.closest('[d-each]'));
    for (const el of elements) {
        // Prefer data-array-path (set by parent d-array for nested arrays) over d-array
        const dataArrayPath = el.getAttribute('data-array-path');
        const dArrayAttr = normalizeBinding(el.getAttribute('d-array'));
        const arrayPath = dataArrayPath || dArrayAttr;
        if (!arrayPath)
            continue;
        // Find the form element — use context first (for detached clones), then closest()
        const formEl = ctx._formElement || el.closest('form[d-form]');
        if (!formEl) {
            warn(`d-array: array "${arrayPath}" must be inside a [d-form]`);
            continue;
        }
        const formBinding = ctx._formBinding || normalizeBinding(formEl.getAttribute('d-form'));
        if (!formBinding)
            continue;
        const form = ctx[formBinding];
        if (!form || typeof form !== 'object' || !('fieldArray' in form))
            continue;
        // Get or create the field array
        const fieldArray = form.fieldArray(arrayPath);
        // Find the template element (d-each inside d-array)
        const templateElement = el.querySelector('[d-each]');
        if (!templateElement) {
            warn(`d-array: array "${arrayPath}" must contain a [d-each] template`);
            continue;
        }
        // Store template reference for closure (TypeScript assertion)
        const template = templateElement;
        const comment = document.createComment(`d-array:${arrayPath}`);
        template.parentNode?.replaceChild(comment, template);
        template.removeAttribute('d-each');
        // Track clones by key to preserve DOM state on reorder
        const clonesByKey = new Map();
        const disposesByKey = new Map();
        const metadataByKey = new Map();
        const itemSignalsByKey = new Map();
        function createClone(key, value, index, count) {
            const clone = template.cloneNode(true);
            // Create context for this item
            const itemCtx = Object.create(ctx);
            // Create signal for item so bindings can react to updates
            const itemSignal = signal(value);
            // Create signals for spread properties (if value is an object)
            // This allows {propName} bindings to update when value changes
            const spreadProps = new Map();
            if (typeof value === 'object' && value !== null) {
                for (const [propKey, propValue] of Object.entries(value)) {
                    const propSignal = signal(propValue);
                    spreadProps.set(propKey, propSignal);
                    itemCtx[propKey] = propSignal;
                }
            }
            itemSignalsByKey.set(key, { item: itemSignal, spreadProps });
            // Use signals for metadata so they can be updated on reorder
            const metadata = {
                $index: signal(index),
                $count: signal(count),
                $first: signal(index === 0),
                $last: signal(index === count - 1),
                $odd: signal(index % 2 !== 0),
                $even: signal(index % 2 === 0),
            };
            metadataByKey.set(key, metadata);
            // Expose item signal and metadata to context
            itemCtx.item = itemSignal;
            itemCtx.key = key;
            itemCtx.$index = metadata.$index;
            itemCtx.$count = metadata.$count;
            itemCtx.$first = metadata.$first;
            itemCtx.$last = metadata.$last;
            itemCtx.$odd = metadata.$odd;
            itemCtx.$even = metadata.$even;
            // Pass form reference for bindField/bindError to use
            // When clone is detached, el.closest('form[d-form]') returns null
            itemCtx._formElement = formEl;
            itemCtx._formBinding = formBinding;
            // Expose array operations bound to this item's key (not index)
            itemCtx.$remove = () => fieldArray.remove(key);
            itemCtx.$moveUp = () => {
                const currentIndex = fieldArray._getIndex(key);
                if (currentIndex > 0)
                    fieldArray.move(currentIndex, currentIndex - 1);
            };
            itemCtx.$moveDown = () => {
                const currentIndex = fieldArray._getIndex(key);
                if (currentIndex < fieldArray.length() - 1)
                    fieldArray.move(currentIndex, currentIndex + 1);
            };
            // Mark and bind clone
            clone.setAttribute('data-dalila-internal-bound', '');
            clone.setAttribute('data-array-key', key);
            // Update field names and d-field to include full path
            // Include clone root itself (for primitive arrays like <input d-each="items" d-field="value">)
            const fields = [];
            if (clone.hasAttribute('d-field'))
                fields.push(clone);
            fields.push(...Array.from(clone.querySelectorAll('[d-field]')));
            for (const field of fields) {
                const relativeFieldPath = field.getAttribute('d-field');
                if (relativeFieldPath) {
                    const fullPath = `${arrayPath}[${index}].${relativeFieldPath}`;
                    field.setAttribute('name', fullPath);
                    // Set data-field-path for bindField to use full path
                    field.setAttribute('data-field-path', fullPath);
                }
            }
            // Also update d-error elements to use full path (including root)
            const errors = [];
            if (clone.hasAttribute('d-error'))
                errors.push(clone);
            errors.push(...Array.from(clone.querySelectorAll('[d-error]')));
            for (const errorEl of errors) {
                const relativeErrorPath = errorEl.getAttribute('d-error');
                if (relativeErrorPath) {
                    const fullPath = `${arrayPath}[${index}].${relativeErrorPath}`;
                    errorEl.setAttribute('data-error-path', fullPath);
                }
            }
            // Update nested d-array elements to use full path (for nested field arrays)
            const nestedArrays = clone.querySelectorAll('[d-array]');
            for (const nestedArr of nestedArrays) {
                const relativeArrayPath = nestedArr.getAttribute('d-array');
                if (relativeArrayPath) {
                    const fullPath = `${arrayPath}[${index}].${relativeArrayPath}`;
                    nestedArr.setAttribute('data-array-path', fullPath);
                }
            }
            // Set type="button" on array control buttons to prevent form submit
            // Buttons like d-on-click="$remove" inside templates aren't processed by
            // bindArrayOperations (they don't exist yet), so set it here during clone creation
            const controlButtons = clone.querySelectorAll('button[d-on-click*="$remove"], button[d-on-click*="$moveUp"], button[d-on-click*="$moveDown"], button[d-on-click*="$swap"]');
            for (const btn of controlButtons) {
                if (btn.getAttribute('type') !== 'button') {
                    btn.setAttribute('type', 'button');
                }
            }
            const dispose = bind(clone, itemCtx, { _skipLifecycle: true });
            disposesByKey.set(key, dispose);
            clonesByKey.set(key, clone);
            return clone;
        }
        function updateCloneIndex(clone, key, value, index, count) {
            // Update field names with new index (values stay in DOM)
            // Include clone root itself (for primitive arrays)
            const fields = [];
            if (clone.hasAttribute('d-field'))
                fields.push(clone);
            fields.push(...Array.from(clone.querySelectorAll('[d-field]')));
            for (const field of fields) {
                const relativeFieldPath = field.getAttribute('d-field');
                if (relativeFieldPath) {
                    const fullPath = `${arrayPath}[${index}].${relativeFieldPath}`;
                    field.setAttribute('name', fullPath);
                    field.setAttribute('data-field-path', fullPath);
                }
            }
            // Update d-error elements (including root)
            const errors = [];
            if (clone.hasAttribute('d-error'))
                errors.push(clone);
            errors.push(...Array.from(clone.querySelectorAll('[d-error]')));
            for (const errorEl of errors) {
                const relativeErrorPath = errorEl.getAttribute('d-error');
                if (relativeErrorPath) {
                    const fullPath = `${arrayPath}[${index}].${relativeErrorPath}`;
                    errorEl.setAttribute('data-error-path', fullPath);
                }
            }
            // Update nested d-array paths
            const nestedArrays = clone.querySelectorAll('[d-array]');
            for (const nestedArr of nestedArrays) {
                const relativeArrayPath = nestedArr.getAttribute('d-array');
                if (relativeArrayPath) {
                    const fullPath = `${arrayPath}[${index}].${relativeArrayPath}`;
                    nestedArr.setAttribute('data-array-path', fullPath);
                }
            }
            // Update metadata signals with new index values
            const metadata = metadataByKey.get(key);
            if (metadata) {
                metadata.$index.set(index);
                metadata.$count.set(count);
                metadata.$first.set(index === 0);
                metadata.$last.set(index === count - 1);
                metadata.$odd.set(index % 2 !== 0);
                metadata.$even.set(index % 2 === 0);
            }
            // Update item signals when value changes via updateAt()
            const itemSignals = itemSignalsByKey.get(key);
            if (itemSignals) {
                // Update the item signal
                itemSignals.item.set(value);
                // Update spread property signals
                if (typeof value === 'object' && value !== null) {
                    const newProps = new Set(Object.keys(value));
                    // Update existing props and clear removed ones
                    for (const [propKey, propSignal] of itemSignals.spreadProps) {
                        if (newProps.has(propKey)) {
                            propSignal.set(value[propKey]);
                        }
                        else {
                            // Property was removed - clear to undefined
                            propSignal.set(undefined);
                        }
                    }
                }
                else {
                    // Value is not an object (null, primitive, etc) - clear all spread props
                    for (const [, propSignal] of itemSignals.spreadProps) {
                        propSignal.set(undefined);
                    }
                }
            }
        }
        function renderList() {
            const items = fieldArray.fields();
            const newKeys = new Set(items.map((item) => item.key));
            // Remove clones for keys that no longer exist
            for (const [key, clone] of clonesByKey) {
                if (!newKeys.has(key)) {
                    clone.remove();
                    clonesByKey.delete(key);
                    metadataByKey.delete(key);
                    itemSignalsByKey.delete(key);
                    const dispose = disposesByKey.get(key);
                    if (dispose) {
                        dispose();
                        disposesByKey.delete(key);
                    }
                }
            }
            // Build new DOM order, reusing existing clones
            const parent = comment.parentNode;
            if (!parent)
                return;
            // Collect all clones in new order
            const orderedClones = [];
            for (let i = 0; i < items.length; i++) {
                const { key, value } = items[i];
                let clone = clonesByKey.get(key);
                if (clone) {
                    // Reuse existing clone, update index-based attributes and item value
                    updateCloneIndex(clone, key, value, i, items.length);
                }
                else {
                    // Create new clone for new key
                    clone = createClone(key, value, i, items.length);
                }
                orderedClones.push(clone);
            }
            // Reorder DOM nodes efficiently
            // Remove all clones from current positions
            for (const clone of orderedClones) {
                if (clone.parentNode) {
                    clone.parentNode.removeChild(clone);
                }
            }
            // Insert in correct order before the comment
            for (const clone of orderedClones) {
                parent.insertBefore(clone, comment);
            }
        }
        // Reactive rendering
        effect(() => {
            renderList();
        });
        // Bind array operation buttons
        bindArrayOperations(el, fieldArray, cleanups);
        cleanups.push(() => {
            for (const clone of clonesByKey.values()) {
                clone.remove();
            }
            for (const dispose of disposesByKey.values()) {
                dispose();
            }
            clonesByKey.clear();
            disposesByKey.clear();
            metadataByKey.clear();
            itemSignalsByKey.clear();
        });
    }
}
/**
 * Bind array operation buttons: d-append, d-remove, d-insert, d-move-up, d-move-down, d-swap
 */
function bindArrayOperations(container, fieldArray, cleanups) {
    // d-append: append new item
    const appendButtons = container.querySelectorAll('[d-append]');
    for (const btn of appendButtons) {
        // Set type="button" to prevent form submit
        // Inside <form>, buttons default to type="submit"
        if (btn.getAttribute('type') !== 'button' && btn.tagName === 'BUTTON') {
            btn.setAttribute('type', 'button');
        }
        const handler = (e) => {
            e.preventDefault(); // Extra safety
            const defaultValue = btn.getAttribute('d-append');
            try {
                const value = defaultValue ? JSON.parse(defaultValue) : {};
                fieldArray.append(value);
            }
            catch {
                fieldArray.append({});
            }
        };
        btn.addEventListener('click', handler);
        cleanups.push(() => btn.removeEventListener('click', handler));
    }
    // d-remove: remove item (uses context from bindArray)
    const removeButtons = container.querySelectorAll('[d-remove]');
    for (const btn of removeButtons) {
        // This is handled in the item context during bindArray
        // Just prevent default if it's a button
        if (btn.getAttribute('type') !== 'button' && btn.tagName === 'BUTTON') {
            btn.setAttribute('type', 'button');
        }
    }
    // d-move-up, d-move-down: handled in item context
    const moveButtons = container.querySelectorAll('[d-move-up], [d-move-down]');
    for (const btn of moveButtons) {
        if (btn.getAttribute('type') !== 'button' && btn.tagName === 'BUTTON') {
            btn.setAttribute('type', 'button');
        }
    }
}
// ============================================================================
// Main bind() Function
// ============================================================================
/**
 * Bind a DOM tree to a reactive context.
 *
 * @param root - The root element to bind
 * @param ctx - The context object containing handlers and reactive values
 * @param options - Binding options
 * @returns A dispose function that removes all bindings
 *
 * @example
 * ```ts
 * import { bind } from 'dalila/runtime';
 *
 * const ctx = {
 *   count: signal(0),
 *   increment: () => count.update(n => n + 1),
 * };
 *
 * const dispose = bind(document.getElementById('app')!, ctx);
 *
 * // Later, to cleanup:
 * dispose();
 * ```
 */
export function bind(root, ctx, options = {}) {
    const events = options.events ?? DEFAULT_EVENTS;
    const rawTextSelectors = options.rawTextSelectors ?? DEFAULT_RAW_TEXT_SELECTORS;
    const htmlRoot = root;
    // HMR support: Register binding context globally in dev mode.
    // Skip for internal (d-each clone) bindings — only the top-level bind owns HMR.
    if (!options._internal && isInDevMode()) {
        globalThis.__dalila_hmr_context = { root, ctx, options };
    }
    // Create a scope for this template binding
    const templateScope = createScope();
    const cleanups = [];
    // Run all bindings within the template scope
    withScope(templateScope, () => {
        // 1. Form setup — must run very early to register form instances
        bindForm(root, ctx, cleanups);
        // 2. d-array — must run before d-each to setup field arrays
        bindArray(root, ctx, cleanups);
        // 3. d-each — must run early: removes templates before TreeWalker visits them
        bindEach(root, ctx, cleanups);
        // 4. Text interpolation
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        // Same boundary logic as qsaIncludingRoot: only visit text nodes that
        // belong to this bind scope, not to nested already-bound subtrees.
        const textBoundary = root.closest('[data-dalila-internal-bound]');
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const parent = node.parentElement;
            // Skip nodes inside raw text containers
            if (parent && parent.closest(rawTextSelectors)) {
                continue;
            }
            // Skip nodes inside already-bound subtrees (d-each clones)
            if (parent) {
                const bound = parent.closest('[data-dalila-internal-bound]');
                if (bound !== textBoundary)
                    continue;
            }
            if (node.data.includes('{')) {
                textNodes.push(node);
            }
        }
        // Process text nodes (collect first, then process to avoid walker issues)
        for (const node of textNodes) {
            bindTextNode(node, ctx, cleanups);
        }
        // 5. d-attr bindings
        bindAttrs(root, ctx, cleanups);
        // 6. d-html bindings
        bindHtml(root, ctx, cleanups);
        // 7. Form fields — register fields with form instances
        bindField(root, ctx, cleanups);
        // 8. Event bindings
        bindEvents(root, ctx, events, cleanups);
        // 9. d-when directive
        bindWhen(root, ctx, cleanups);
        // 10. d-match directive
        bindMatch(root, ctx, cleanups);
        // 11. Form error displays — BEFORE d-if to bind errors in conditionally rendered sections
        bindError(root, ctx, cleanups);
        bindFormError(root, ctx, cleanups);
        // 12. d-if — must run last: elements are fully bound before conditional removal
        bindIf(root, ctx, cleanups);
    });
    // Bindings complete: remove loading state and mark as ready.
    // Only the top-level bind owns this lifecycle — d-each clones skip it.
    if (!options._skipLifecycle) {
        queueMicrotask(() => {
            htmlRoot.removeAttribute('d-loading');
            htmlRoot.setAttribute('d-ready', '');
        });
    }
    // Return dispose function
    return () => {
        // Run manual cleanups (event listeners)
        for (const cleanup of cleanups) {
            if (typeof cleanup === 'function') {
                try {
                    cleanup();
                }
                catch (e) {
                    if (isInDevMode()) {
                        console.warn('[Dalila] Cleanup error:', e);
                    }
                }
            }
        }
        cleanups.length = 0;
        // Dispose template scope (stops all effects)
        try {
            templateScope.dispose();
        }
        catch (e) {
            if (isInDevMode()) {
                console.warn('[Dalila] Scope dispose error:', e);
            }
        }
    };
}
// ============================================================================
// Convenience: Auto-bind on DOMContentLoaded
// ============================================================================
/**
 * Automatically bind when DOM is ready.
 * Useful for simple pages without a build step.
 *
 * @example
 * ```html
 * <script type="module">
 *   import { autoBind } from 'dalila/runtime';
 *   autoBind('#app', { count: signal(0) });
 * </script>
 * ```
 */
export function autoBind(selector, ctx, options) {
    return new Promise((resolve, reject) => {
        const doBind = () => {
            const root = document.querySelector(selector);
            if (!root) {
                reject(new Error(`[Dalila] Element not found: ${selector}`));
                return;
            }
            resolve(bind(root, ctx, options));
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', doBind, { once: true });
        }
        else {
            doBind();
        }
    });
}
