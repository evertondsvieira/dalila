import { normalizeRules, validateValue } from './validation.js';
export function createRouteValidationHelpers() {
    const resolvedValidationByRoute = new WeakMap();
    const queryValidatorsByRoute = new WeakMap();
    const paramsValidatorsByRoute = new WeakMap();
    async function resolveRouteValidation(match) {
        if (resolvedValidationByRoute.has(match.route)) {
            return resolvedValidationByRoute.get(match.route) ?? null;
        }
        const source = match.route.validation;
        if (!source) {
            resolvedValidationByRoute.set(match.route, null);
            return null;
        }
        const resolved = typeof source === 'function'
            ? await source()
            : source;
        if (!resolved || typeof resolved !== 'object') {
            resolvedValidationByRoute.set(match.route, null);
            return null;
        }
        resolvedValidationByRoute.set(match.route, resolved);
        return resolved;
    }
    function resolveQueryValidators(route, querySchema) {
        if (queryValidatorsByRoute.has(route)) {
            return queryValidatorsByRoute.get(route) ?? null;
        }
        const validatorsByKey = new Map();
        for (const [key, rulesInput] of Object.entries(querySchema)) {
            if (!Array.isArray(rulesInput))
                continue;
            const validators = normalizeRules(rulesInput, `query.${key}`);
            if (validators.length > 0) {
                validatorsByKey.set(key, validators);
            }
        }
        const result = validatorsByKey.size > 0 ? validatorsByKey : null;
        queryValidatorsByRoute.set(route, result);
        return result;
    }
    function resolveParamsValidators(route, paramsSchema) {
        if (paramsValidatorsByRoute.has(route)) {
            return paramsValidatorsByRoute.get(route) ?? null;
        }
        const validatorsByKey = new Map();
        for (const [key, rulesInput] of Object.entries(paramsSchema)) {
            if (!Array.isArray(rulesInput))
                continue;
            const validators = normalizeRules(rulesInput, `params.${key}`);
            if (validators.length > 0) {
                validatorsByKey.set(key, validators);
            }
        }
        const result = validatorsByKey.size > 0 ? validatorsByKey : null;
        paramsValidatorsByRoute.set(route, result);
        return result;
    }
    async function resolveRouteQueryValidationError(match, queryValues) {
        const validation = await resolveRouteValidation(match);
        const querySchema = validation?.query;
        if (!querySchema)
            return null;
        const validatorsByKey = resolveQueryValidators(match.route, querySchema);
        if (!validatorsByKey)
            return null;
        for (const [key, validators] of validatorsByKey.entries()) {
            const value = queryValues[key];
            const message = validateValue(value, queryValues, validators, `query.${key}`);
            if (message)
                return new Error(`Invalid query param "${key}": ${message}`);
        }
        return null;
    }
    async function resolveRouteParamsValidationError(match, paramsValues) {
        const validation = await resolveRouteValidation(match);
        const paramsSchema = validation?.params;
        if (!paramsSchema)
            return null;
        const validatorsByKey = resolveParamsValidators(match.route, paramsSchema);
        if (!validatorsByKey)
            return null;
        for (const [key, validators] of validatorsByKey.entries()) {
            const value = paramsValues[key];
            const message = validateValue(value, paramsValues, validators, `params.${key}`);
            if (message)
                return new Error(`Invalid route param "${key}": ${message}`);
        }
        return null;
    }
    async function resolveRouteValidationError(match, queryValues, paramsValues) {
        const queryError = await resolveRouteQueryValidationError(match, queryValues);
        if (queryError)
            return queryError;
        return resolveRouteParamsValidationError(match, paramsValues);
    }
    return {
        resolveRouteValidationError,
    };
}
