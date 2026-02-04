function hasValue(value) {
    if (value === null || value === undefined)
        return false;
    if (typeof value === 'string')
        return value.trim().length > 0;
    if (Array.isArray(value))
        return value.length > 0;
    return true;
}
function toLength(value) {
    if (typeof value === 'string' || Array.isArray(value))
        return value.length;
    if (typeof value === 'number')
        return value;
    return null;
}
function toNumericOrLength(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0)
            return 0;
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric))
            return numeric;
        return value.length;
    }
    if (Array.isArray(value)) {
        return value.length;
    }
    return null;
}
function toNumber(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function parseRuleName(input) {
    const separator = input.indexOf(':');
    if (separator === -1) {
        return { name: input.trim(), arg: undefined };
    }
    return {
        name: input.slice(0, separator).trim(),
        arg: input.slice(separator + 1).trim()
    };
}
function normalizeInValues(value) {
    if (Array.isArray(value))
        return value.map(v => String(v));
    if (typeof value === 'string')
        return value.split(',').map(v => v.trim()).filter(Boolean);
    return [];
}
function buildBuiltinRule(name, rawArg, message) {
    const fail = (fallback) => message ?? fallback;
    switch (name) {
        case 'required':
            return value => (hasValue(value) ? undefined : fail('This field is required.'));
        case 'min': {
            const min = toNumber(rawArg);
            if (min === null)
                return () => undefined;
            return value => {
                const size = toNumericOrLength(value);
                if (size === null)
                    return undefined;
                return size >= min ? undefined : fail(`Must be at least ${min}.`);
            };
        }
        case 'max': {
            const max = toNumber(rawArg);
            if (max === null)
                return () => undefined;
            return value => {
                const size = toNumericOrLength(value);
                if (size === null)
                    return undefined;
                return size <= max ? undefined : fail(`Must be at most ${max}.`);
            };
        }
        case 'pattern': {
            const pattern = typeof rawArg === 'string' ? rawArg : String(rawArg ?? '');
            if (!pattern)
                return () => undefined;
            let regex;
            try {
                regex = new RegExp(pattern);
            }
            catch {
                return () => undefined;
            }
            return value => {
                if (value === undefined || value === null)
                    return undefined;
                return regex.test(String(value)) ? undefined : fail('Invalid format.');
            };
        }
        case 'email': {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return value => {
                if (value === undefined || value === null || value === '')
                    return undefined;
                return emailRegex.test(String(value)) ? undefined : fail('Invalid email.');
            };
        }
        case 'in': {
            const allowed = normalizeInValues(rawArg);
            if (allowed.length === 0)
                return () => undefined;
            return value => {
                if (value === undefined || value === null)
                    return undefined;
                return allowed.includes(String(value)) ? undefined : fail(`Must be one of: ${allowed.join(', ')}.`);
            };
        }
        default:
            return () => undefined;
    }
}
export function normalizeRules(rules, _field) {
    const normalized = [];
    for (const rule of rules) {
        if (typeof rule === 'function') {
            normalized.push(rule);
            continue;
        }
        if (typeof rule === 'string') {
            const { name, arg } = parseRuleName(rule);
            if (!name)
                continue;
            normalized.push(buildBuiltinRule(name, arg));
            continue;
        }
        if (!rule || typeof rule !== 'object') {
            continue;
        }
        if (typeof rule.rule === 'function') {
            const fn = rule.rule;
            normalized.push((value, values) => {
                const result = fn(value, values);
                if (result === true || result === undefined || result === null)
                    return undefined;
                if (result === false)
                    return rule.message ?? 'Invalid value.';
                return typeof result === 'string' ? result : undefined;
            });
            continue;
        }
        if (typeof rule.rule === 'string') {
            normalized.push(buildBuiltinRule(rule.rule, rule.value, rule.message));
        }
    }
    return normalized;
}
export function validateValue(value, values, validators, _field) {
    for (const validator of validators) {
        const result = validator(value, values);
        if (result === true || result === undefined || result === null) {
            continue;
        }
        if (result === false) {
            return 'Invalid value.';
        }
        if (typeof result === 'string') {
            const message = result.trim();
            if (message)
                return message;
        }
    }
    return null;
}
