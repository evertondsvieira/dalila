const TRUSTED_POLICY_CACHE_KEY = Symbol.for('dalila.runtime.trustedTypesPolicies');
const TRUSTED_POLICY_PARSE_SUFFIX = '--dalila-parse';
const EXECUTABLE_HTML_SCRIPT_PATTERN = /<script[\s/>]/i;
const EXECUTABLE_HTML_EVENT_ATTR_PATTERN = /<[^>]+\son[a-z0-9:_-]+\s*=/i;
const EXECUTABLE_HTML_URL_ATTR_PATTERN = /<[^>]+\s(?:href|src|xlink:href|formaction|action|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
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
function hasExecutableHtmlUrlAttribute(value) {
    EXECUTABLE_HTML_URL_ATTR_PATTERN.lastIndex = 0;
    let match = null;
    while ((match = EXECUTABLE_HTML_URL_ATTR_PATTERN.exec(value)) !== null) {
        const attrValue = match[1] ?? match[2] ?? match[3] ?? '';
        const normalized = normalizeHtmlUrlAttrValue(attrValue);
        if (!normalized)
            continue;
        if (normalized.startsWith('javascript:'))
            return true;
        if (EXECUTABLE_DATA_URL_PATTERN.test(normalized))
            return true;
    }
    return false;
}
export function hasExecutableHtmlSinkPattern(value) {
    if (!value)
        return false;
    return EXECUTABLE_HTML_SCRIPT_PATTERN.test(value)
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
