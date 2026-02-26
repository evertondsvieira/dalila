export function isPromiseLike(value) {
    return !!value && typeof value.then === 'function';
}
export function createValidationController(deps) {
    const { options, getNestedValue, isPathRelated, errors, formErrorSignal } = deps;
    let validationRunSeq = 0;
    let formValidationRunId = 0;
    let formInvalidationId = 0;
    const latestFieldValidationByPath = new Map();
    function beginValidation(path) {
        if (path) {
            formInvalidationId += 1;
            const runId = ++validationRunSeq;
            latestFieldValidationByPath.set(path, runId);
            return {
                kind: 'path',
                path,
                runId,
                formRunIdAtStart: formValidationRunId,
                formInvalidationIdAtStart: formInvalidationId,
            };
        }
        formValidationRunId += 1;
        latestFieldValidationByPath.clear();
        const runId = ++validationRunSeq;
        return {
            kind: 'form',
            runId,
            formRunIdAtStart: formValidationRunId,
            formInvalidationIdAtStart: formInvalidationId,
        };
    }
    function isValidationCurrent(token) {
        if (token.kind === 'form') {
            return token.formRunIdAtStart === formValidationRunId &&
                token.formInvalidationIdAtStart === formInvalidationId;
        }
        if (!token.path)
            return false;
        return token.formRunIdAtStart === formValidationRunId &&
            latestFieldValidationByPath.get(token.path) === token.runId;
    }
    function mergeValidationOutcomes(outcomes) {
        const mergedFieldErrors = {};
        let formError = undefined;
        let value;
        let hasValue = false;
        for (const outcome of outcomes) {
            for (const [path, message] of Object.entries(outcome.fieldErrors)) {
                if (!(path in mergedFieldErrors))
                    mergedFieldErrors[path] = message;
            }
            if (formError == null && typeof outcome.formError === 'string' && outcome.formError.length > 0) {
                formError = outcome.formError;
            }
            if (outcome.hasValue) {
                hasValue = true;
                value = outcome.value;
            }
        }
        return { fieldErrors: mergedFieldErrors, formError, value, hasValue };
    }
    function normalizeLegacyValidationResult(result) {
        if (!result || typeof result !== 'object')
            return { fieldErrors: {} };
        if ('fieldErrors' in result || 'formError' in result) {
            const typedResult = result;
            return {
                fieldErrors: typedResult.fieldErrors ?? {},
                formError: typedResult.formError,
            };
        }
        return { fieldErrors: result };
    }
    function normalizeSchemaValidationResult(result) {
        const fieldErrors = {};
        let formError = result.formError;
        const hasValue = Object.prototype.hasOwnProperty.call(result, 'value');
        for (const issue of result.issues ?? []) {
            if (issue.path && !(issue.path in fieldErrors)) {
                fieldErrors[issue.path] = issue.message;
                continue;
            }
            if (!issue.path && formError == null) {
                formError = issue.message;
            }
        }
        return { fieldErrors, formError, value: result.value, hasValue };
    }
    function runLegacyValidation(data) {
        if (!options.validate)
            return { fieldErrors: {} };
        const result = options.validate(data);
        if (isPromiseLike(result)) {
            return result
                .then((resolved) => normalizeLegacyValidationResult(resolved))
                .catch((error) => ({
                fieldErrors: {},
                formError: error instanceof Error ? error.message : 'Validation failed',
            }));
        }
        return normalizeLegacyValidationResult(result);
    }
    function runSchemaValidation(data, path) {
        if (!options.schema)
            return { fieldErrors: {} };
        const schema = options.schema;
        const execute = () => {
            if (path && schema.validateField) {
                return schema.validateField(path, getNestedValue(data, path), data);
            }
            return schema.validate(data);
        };
        const normalizeMappedError = (error) => {
            const mapped = schema.mapErrors?.(error);
            if (Array.isArray(mapped)) {
                if (mapped.length === 0) {
                    return {
                        fieldErrors: {},
                        formError: error instanceof Error ? error.message : 'Schema validation failed',
                    };
                }
                return normalizeSchemaValidationResult({ issues: mapped });
            }
            if (mapped && typeof mapped === 'object') {
                const mappedFormError = mapped.formError;
                if (typeof mappedFormError === 'string' && mappedFormError.length > 0) {
                    return { fieldErrors: {}, formError: mappedFormError };
                }
            }
            return {
                fieldErrors: {},
                formError: error instanceof Error ? error.message : 'Schema validation failed',
            };
        };
        try {
            const result = execute();
            if (isPromiseLike(result)) {
                return result
                    .then((resolved) => normalizeSchemaValidationResult(resolved))
                    .catch((error) => normalizeMappedError(error));
            }
            return normalizeSchemaValidationResult(result);
        }
        catch (error) {
            return normalizeMappedError(error);
        }
    }
    function applyValidationOutcome(outcome, path) {
        if (path && options.schema?.validateField) {
            errors.update((prev) => {
                const next = {};
                for (const [key, message] of Object.entries(prev)) {
                    if (!isPathRelated(key, path))
                        next[key] = message;
                }
                for (const [key, message] of Object.entries(outcome.fieldErrors)) {
                    if (isPathRelated(key, path))
                        next[key] = message;
                }
                return next;
            });
            formErrorSignal.set(outcome.formError ?? null);
        }
        else {
            errors.set(outcome.fieldErrors);
            formErrorSignal.set(outcome.formError ?? null);
        }
        return Object.keys(outcome.fieldErrors).length === 0 &&
            !(typeof outcome.formError === 'string' && outcome.formError.length > 0);
    }
    function resolveValidationOutcome(data, opts = {}) {
        if (!options.schema && !options.validate) {
            return { fieldErrors: {}, value: data, hasValue: true };
        }
        const runLegacyAfterSchema = (schemaOutcome) => {
            if (!options.validate)
                return schemaOutcome;
            const legacyInput = schemaOutcome.hasValue ? schemaOutcome.value : data;
            const legacyOutcome = runLegacyValidation(legacyInput);
            if (!isPromiseLike(legacyOutcome)) {
                return mergeValidationOutcomes([schemaOutcome, legacyOutcome]);
            }
            return Promise.resolve(legacyOutcome).then((resolvedLegacy) => mergeValidationOutcomes([schemaOutcome, resolvedLegacy]));
        };
        if (options.schema) {
            const schemaOutcome = runSchemaValidation(data, opts.path);
            if (!isPromiseLike(schemaOutcome)) {
                return runLegacyAfterSchema(schemaOutcome);
            }
            return Promise.resolve(schemaOutcome).then((resolvedSchema) => runLegacyAfterSchema(resolvedSchema));
        }
        return runLegacyValidation(data);
    }
    function finalizeValidation(token, sourceData, outcome, opts = {}) {
        if (!isValidationCurrent(token)) {
            return { isValid: false, data: sourceData };
        }
        const isValid = applyValidationOutcome(outcome, opts.path);
        const data = outcome.hasValue ? outcome.value : sourceData;
        return { isValid, data };
    }
    function validate(data, opts = {}) {
        const token = beginValidation(opts.path);
        const outcome = resolveValidationOutcome(data, opts);
        if (!isPromiseLike(outcome)) {
            return finalizeValidation(token, data, outcome, opts).isValid;
        }
        return outcome.then((resolved) => finalizeValidation(token, data, resolved, opts).isValid);
    }
    function validateForSubmit(data) {
        const token = beginValidation();
        const outcome = resolveValidationOutcome(data);
        if (!isPromiseLike(outcome)) {
            return finalizeValidation(token, data, outcome);
        }
        return outcome.then((resolved) => finalizeValidation(token, data, resolved));
    }
    return {
        validate,
        validateForSubmit,
    };
}
