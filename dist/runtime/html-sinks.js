const TRUSTED_POLICY_CACHE_KEY = Symbol.for('dalila.runtime.trustedTypesPolicies');
const TRUSTED_POLICY_PARSE_SUFFIX = '--dalila-parse';
const EXECUTABLE_HTML_EVENT_ATTR_PATTERN = /<[^>]+\son[a-z0-9:_-]+\s*=/i;
const EXECUTABLE_HTML_URL_ATTR_NAMES = new Set([
    'href',
    'src',
    'xlink:href',
    'formaction',
    'action',
    'poster',
]);
const EXECUTABLE_DATA_URL_PATTERN = /^data:(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)\b/i;
function getTrustedPolicyCache() {
    const host = globalThis;
    if (host[TRUSTED_POLICY_CACHE_KEY] instanceof Map) {
        return host[TRUSTED_POLICY_CACHE_KEY];
    }
    const cache = new Map();
    host[TRUSTED_POLICY_CACHE_KEY] = cache;
    return cache;
}
const trustedPolicyCache = getTrustedPolicyCache();
function normalizeHtmlUrlAttrValue(value) {
    return value.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
}
function isHtmlWhitespaceCode(code) {
    return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}
function isHtmlAttributeNameChar(code) {
    return !Number.isNaN(code)
        && code !== 0x20
        && code !== 0x09
        && code !== 0x0a
        && code !== 0x0c
        && code !== 0x0d
        && code !== 0x22
        && code !== 0x27
        && code !== 0x2f
        && code !== 0x3c
        && code !== 0x3d
        && code !== 0x3e
        && code !== 0x60;
}
function isTagBoundaryChar(char) {
    return !char || /[\s/>]/.test(char);
}
function getPreviousNonWhitespaceChar(value, end, start = 0) {
    for (let index = end - 1; index >= start; index -= 1) {
        if (!isHtmlWhitespaceCode(value.charCodeAt(index))) {
            return value[index];
        }
    }
    return undefined;
}
function isHtmlTagStartChar(char) {
    return !!char && /[A-Za-z/!?]/.test(char);
}
function findTagLikeStart(value, start, end = value.length) {
    let index = value.indexOf('<', start);
    while (index !== -1 && index < end) {
        if (isHtmlTagStartChar(value[index + 1])) {
            return index;
        }
        index = value.indexOf('<', index + 1);
    }
    return -1;
}
function hasExecutableHtmlScriptTag(value) {
    const lower = value.toLowerCase();
    let searchIndex = 0;
    while (searchIndex < lower.length) {
        const index = lower.indexOf('<script', searchIndex);
        if (index === -1)
            return false;
        if (isTagBoundaryChar(lower[index + 7])) {
            return true;
        }
        searchIndex = index + 7;
    }
    return false;
}
function hasExecutableProtocol(value) {
    return value.startsWith('javascript:')
        || value.startsWith('vbscript:')
        || EXECUTABLE_DATA_URL_PATTERN.test(value);
}
function hasExecutableHtmlUrlAttribute(value) {
    let index = 0;
    while (index < value.length) {
        const tagStart = value.indexOf('<', index);
        if (tagStart === -1)
            return false;
        let cursor = tagStart + 1;
        const firstCode = value.charCodeAt(cursor);
        if (Number.isNaN(firstCode)
            || value[cursor] === '/'
            || value[cursor] === '!'
            || value[cursor] === '?') {
            index = cursor;
            continue;
        }
        while (cursor < value.length && !isHtmlWhitespaceCode(value.charCodeAt(cursor)) && value[cursor] !== '>') {
            cursor += 1;
        }
        while (cursor < value.length && value[cursor] !== '>') {
            while (cursor < value.length && isHtmlWhitespaceCode(value.charCodeAt(cursor))) {
                cursor += 1;
            }
            if (cursor >= value.length || value[cursor] === '>') {
                break;
            }
            if (value[cursor] === '/') {
                cursor += 1;
                continue;
            }
            const nameStart = cursor;
            while (cursor < value.length && isHtmlAttributeNameChar(value.charCodeAt(cursor))) {
                cursor += 1;
            }
            if (cursor === nameStart) {
                cursor += 1;
                continue;
            }
            const attrName = value.slice(nameStart, cursor).toLowerCase();
            while (cursor < value.length && isHtmlWhitespaceCode(value.charCodeAt(cursor))) {
                cursor += 1;
            }
            if (value[cursor] !== '=') {
                continue;
            }
            cursor += 1;
            while (cursor < value.length && isHtmlWhitespaceCode(value.charCodeAt(cursor))) {
                cursor += 1;
            }
            if (cursor >= value.length) {
                break;
            }
            let attrValue = '';
            let recoveryTagIndex = -1;
            let unterminatedQuotedValue = false;
            const quote = value[cursor];
            if (quote === '"' || quote === '\'') {
                cursor += 1;
                const valueStart = cursor;
                const closingQuoteIndex = value.indexOf(quote, valueStart);
                const quotedValueEnd = closingQuoteIndex === -1 ? value.length : closingQuoteIndex;
                recoveryTagIndex = findTagLikeStart(value, valueStart, quotedValueEnd);
                if (closingQuoteIndex === -1) {
                    unterminatedQuotedValue = true;
                    const valueEnd = recoveryTagIndex === -1 ? value.length : recoveryTagIndex;
                    attrValue = value.slice(valueStart, valueEnd);
                }
                else {
                    const hasSuspiciousQuotedRestart = recoveryTagIndex !== -1
                        && getPreviousNonWhitespaceChar(value, closingQuoteIndex, valueStart) === '=';
                    if (hasSuspiciousQuotedRestart) {
                        unterminatedQuotedValue = true;
                        attrValue = value.slice(valueStart, recoveryTagIndex);
                    }
                    else {
                        cursor = closingQuoteIndex;
                        attrValue = value.slice(valueStart, cursor);
                        cursor += 1;
                    }
                }
            }
            else {
                const valueStart = cursor;
                while (cursor < value.length
                    && !isHtmlWhitespaceCode(value.charCodeAt(cursor))
                    && value[cursor] !== '>') {
                    cursor += 1;
                }
                attrValue = value.slice(valueStart, cursor);
            }
            if (EXECUTABLE_HTML_URL_ATTR_NAMES.has(attrName)) {
                const normalized = normalizeHtmlUrlAttrValue(attrValue);
                if (normalized && hasExecutableProtocol(normalized)) {
                    return true;
                }
            }
            if (unterminatedQuotedValue && recoveryTagIndex !== -1) {
                return hasExecutableHtmlUrlAttribute(value.slice(recoveryTagIndex));
            }
            if (unterminatedQuotedValue) {
                return false;
            }
        }
        index = cursor + 1;
    }
    return false;
}
export function hasExecutableHtmlSinkPattern(value) {
    if (!value)
        return false;
    return hasExecutableHtmlScriptTag(value)
        || EXECUTABLE_HTML_EVENT_ATTR_PATTERN.test(value)
        || hasExecutableHtmlUrlAttribute(value);
}
function getTrustedTypesApi() {
    const maybe = globalThis.trustedTypes;
    if (!maybe || typeof maybe.createPolicy !== 'function')
        return null;
    return maybe;
}
function isTrustedTypesHtmlPolicy(policy) {
    return !!policy && typeof policy.createHTML === 'function';
}
function cacheTrustedTypesPolicy(policyName, policy) {
    if (policy)
        trustedPolicyCache.set(policyName, policy);
    return policy;
}
function buildTrustedTypesPolicyError(policyName, reason) {
    const suffix = reason == null
        ? ''
        : ` (${reason instanceof Error ? reason.message : String(reason)})`;
    return new Error(`Trusted Types policy "${policyName}" could not be created or reused${suffix}. ` +
        'Provide security.trustedTypesPolicy or choose a unique security.trustedTypesPolicyName.');
}
function getOrCreateTrustedTypesPolicy(security, trustedTypes) {
    const policyName = security.trustedTypesPolicyName;
    if (isTrustedTypesHtmlPolicy(security.trustedTypesPolicy)) {
        return cacheTrustedTypesPolicy(policyName, security.trustedTypesPolicy);
    }
    if (trustedPolicyCache.has(policyName)) {
        const cached = trustedPolicyCache.get(policyName);
        if (cached)
            return cached;
    }
    let policy = null;
    try {
        if (typeof trustedTypes.getPolicy === 'function') {
            const existing = trustedTypes.getPolicy(policyName);
            policy = isTrustedTypesHtmlPolicy(existing) ? existing : null;
        }
    }
    catch {
        policy = null;
    }
    if (policy) {
        trustedPolicyCache.set(policyName, policy);
        return policy;
    }
    let createError;
    try {
        const created = trustedTypes.createPolicy(policyName, {
            createHTML: (input) => input,
        });
        if (isTrustedTypesHtmlPolicy(created)) {
            trustedPolicyCache.set(policyName, created);
            return created;
        }
        createError = new Error(`trustedTypes.createPolicy("${policyName}") did not return a valid policy`);
    }
    catch (err) {
        createError = err;
    }
    try {
        if (typeof trustedTypes.getPolicy === 'function') {
            const existing = trustedTypes.getPolicy(policyName);
            policy = isTrustedTypesHtmlPolicy(existing) ? existing : null;
        }
    }
    catch {
        policy = null;
    }
    if (policy) {
        trustedPolicyCache.set(policyName, policy);
        return policy;
    }
    throw buildTrustedTypesPolicyError(policyName, createError ?? `trustedTypes.createPolicy("${policyName}") returned no reusable policy`);
}
export function resolveHtmlSinkSecurityOptions(security) {
    const strict = security?.strict === true;
    const hasExplicitPolicyName = !!security && Object.prototype.hasOwnProperty.call(security, 'trustedTypesPolicyName');
    const trustedTypesRequested = security?.trustedTypes ?? (security?.trustedTypesPolicy != null ||
        hasExplicitPolicyName);
    return {
        strict,
        trustedTypes: trustedTypesRequested,
        trustedTypesPolicyName: security?.trustedTypesPolicyName ?? 'dalila',
        trustedTypesPolicy: security?.trustedTypesPolicy ?? null,
    };
}
function coerceSinkHtmlValue(html, security) {
    if (!security.trustedTypes)
        return html;
    if (isTrustedTypesHtmlPolicy(security.trustedTypesPolicy)) {
        return cacheTrustedTypesPolicy(security.trustedTypesPolicyName, security.trustedTypesPolicy).createHTML(html);
    }
    const trustedTypes = getTrustedTypesApi();
    if (!trustedTypes)
        return html;
    const policy = getOrCreateTrustedTypesPolicy(security, trustedTypes);
    return policy.createHTML(html);
}
function coerceTemplateParsingHtmlValue(html, security) {
    if (!security.trustedTypes)
        return html;
    const trustedTypes = getTrustedTypesApi();
    if (!trustedTypes)
        return html;
    const parsingSecurity = {
        ...security,
        trustedTypesPolicyName: `${security.trustedTypesPolicyName}${TRUSTED_POLICY_PARSE_SUFFIX}`,
        trustedTypesPolicy: null,
    };
    const policy = getOrCreateTrustedTypesPolicy(parsingSecurity, trustedTypes);
    return policy.createHTML(html);
}
export function setElementInnerHTML(element, html, security) {
    const resolved = resolveHtmlSinkSecurityOptions(security);
    element.innerHTML = coerceSinkHtmlValue(html, resolved);
}
export function setTemplateInnerHTML(template, html, security) {
    const resolved = resolveHtmlSinkSecurityOptions(security);
    template.innerHTML = coerceSinkHtmlValue(html, resolved);
}
export function setTemplateInnerHTMLForParsing(template, html, security) {
    const resolved = resolveHtmlSinkSecurityOptions(security);
    template.innerHTML = coerceTemplateParsingHtmlValue(html, resolved);
}
