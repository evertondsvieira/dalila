import type { Signal } from '../core/signal.js';
import type {
  FieldErrors,
  FormOptions,
  SchemaValidationResult,
} from './form-types.js';

export interface ValidationOutcome<T> {
  fieldErrors: FieldErrors;
  formError?: string | null;
  value?: T;
  hasValue?: boolean;
}

interface ValidationToken {
  kind: 'form' | 'path';
  path?: string;
  runId: number;
  formRunIdAtStart: number;
  formInvalidationIdAtStart: number;
}

interface ValidationControllerDeps<T> {
  options: FormOptions<T>;
  getNestedValue: (obj: any, path: string) => unknown;
  isPathRelated: (a: string, b: string) => boolean;
  errors: Signal<FieldErrors>;
  formErrorSignal: Signal<string | null>;
}

export function isPromiseLike<TValue>(value: unknown): value is Promise<TValue> {
  return !!value && typeof (value as { then?: unknown }).then === 'function';
}

export function createValidationController<T>(deps: ValidationControllerDeps<T>) {
  const { options, getNestedValue, isPathRelated, errors, formErrorSignal } = deps;

  let validationRunSeq = 0;
  let formValidationRunId = 0;
  let formInvalidationId = 0;
  const latestFieldValidationByPath = new Map<string, number>();

  function beginValidation(path?: string): ValidationToken {
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

  function isValidationCurrent(token: ValidationToken): boolean {
    if (token.kind === 'form') {
      return token.formRunIdAtStart === formValidationRunId &&
        token.formInvalidationIdAtStart === formInvalidationId;
    }
    if (!token.path) return false;
    return token.formRunIdAtStart === formValidationRunId &&
      latestFieldValidationByPath.get(token.path) === token.runId;
  }

  function mergeValidationOutcomes(outcomes: readonly ValidationOutcome<T>[]): ValidationOutcome<T> {
    const mergedFieldErrors: FieldErrors = {};
    let formError: string | null | undefined = undefined;
    let value: T | undefined;
    let hasValue = false;

    for (const outcome of outcomes) {
      for (const [path, message] of Object.entries(outcome.fieldErrors)) {
        if (!(path in mergedFieldErrors)) mergedFieldErrors[path] = message;
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

  function normalizeLegacyValidationResult(
    result: FieldErrors | { fieldErrors?: FieldErrors; formError?: string } | void
  ): ValidationOutcome<T> {
    if (!result || typeof result !== 'object') return { fieldErrors: {} };

    if ('fieldErrors' in result || 'formError' in result) {
      const typedResult = result as { fieldErrors?: FieldErrors; formError?: string };
      return {
        fieldErrors: typedResult.fieldErrors ?? {},
        formError: typedResult.formError,
      };
    }

    return { fieldErrors: result as FieldErrors };
  }

  function normalizeSchemaValidationResult(result: SchemaValidationResult<T>): ValidationOutcome<T> {
    const fieldErrors: FieldErrors = {};
    let formError: string | undefined = result.formError;
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

  function runLegacyValidation(data: T): ValidationOutcome<T> | Promise<ValidationOutcome<T>> {
    if (!options.validate) return { fieldErrors: {} };

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

  function runSchemaValidation(
    data: T,
    path?: string
  ): ValidationOutcome<T> | Promise<ValidationOutcome<T>> {
    if (!options.schema) return { fieldErrors: {} };

    const schema = options.schema;
    const execute = () => {
      if (path && schema.validateField) {
        return schema.validateField(path, getNestedValue(data, path), data);
      }
      return schema.validate(data);
    };

    const normalizeMappedError = (error: unknown): ValidationOutcome<T> => {
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
        const mappedFormError = (mapped as { formError?: string }).formError;
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
    } catch (error) {
      return normalizeMappedError(error);
    }
  }

  function applyValidationOutcome(outcome: ValidationOutcome<T>, path?: string): boolean {
    if (path && options.schema?.validateField) {
      errors.update((prev) => {
        const next: FieldErrors = {};
        for (const [key, message] of Object.entries(prev)) {
          if (!isPathRelated(key, path)) next[key] = message;
        }
        for (const [key, message] of Object.entries(outcome.fieldErrors)) {
          if (isPathRelated(key, path)) next[key] = message;
        }
        return next;
      });
      formErrorSignal.set(outcome.formError ?? null);
    } else {
      errors.set(outcome.fieldErrors);
      formErrorSignal.set(outcome.formError ?? null);
    }

    return Object.keys(outcome.fieldErrors).length === 0 &&
      !(typeof outcome.formError === 'string' && outcome.formError.length > 0);
  }

  function resolveValidationOutcome(
    data: T,
    opts: { path?: string } = {}
  ): ValidationOutcome<T> | Promise<ValidationOutcome<T>> {
    if (!options.schema && !options.validate) {
      return { fieldErrors: {}, value: data, hasValue: true };
    }

    const runLegacyAfterSchema = (
      schemaOutcome: ValidationOutcome<T>
    ): ValidationOutcome<T> | Promise<ValidationOutcome<T>> => {
      if (!options.validate) return schemaOutcome;
      const legacyInput = schemaOutcome.hasValue ? (schemaOutcome.value as T) : data;
      const legacyOutcome = runLegacyValidation(legacyInput);
      if (!isPromiseLike(legacyOutcome)) {
        return mergeValidationOutcomes([schemaOutcome, legacyOutcome]);
      }
      return Promise.resolve(legacyOutcome).then((resolvedLegacy) =>
        mergeValidationOutcomes([schemaOutcome, resolvedLegacy])
      );
    };

    if (options.schema) {
      const schemaOutcome = runSchemaValidation(data, opts.path);
      if (!isPromiseLike(schemaOutcome)) {
        return runLegacyAfterSchema(schemaOutcome);
      }
      return Promise.resolve(schemaOutcome).then((resolvedSchema) =>
        runLegacyAfterSchema(resolvedSchema)
      );
    }

    return runLegacyValidation(data);
  }

  function finalizeValidation(
    token: ValidationToken,
    sourceData: T,
    outcome: ValidationOutcome<T>,
    opts: { path?: string } = {}
  ): { isValid: boolean; data: T } {
    if (!isValidationCurrent(token)) {
      return { isValid: false, data: sourceData };
    }
    const isValid = applyValidationOutcome(outcome, opts.path);
    const data = outcome.hasValue ? (outcome.value as T) : sourceData;
    return { isValid, data };
  }

  function validate(data: T, opts: { path?: string } = {}): boolean | Promise<boolean> {
    const token = beginValidation(opts.path);
    const outcome = resolveValidationOutcome(data, opts);
    if (!isPromiseLike(outcome)) {
      return finalizeValidation(token, data, outcome, opts).isValid;
    }
    return outcome.then((resolved) => finalizeValidation(token, data, resolved, opts).isValid);
  }

  function validateForSubmit(
    data: T
  ): { isValid: boolean; data: T } | Promise<{ isValid: boolean; data: T }> {
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
