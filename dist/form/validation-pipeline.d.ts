import type { Signal } from '../core/signal.js';
import type { FieldErrors, FormOptions } from './form-types.js';
export interface ValidationOutcome<T> {
    fieldErrors: FieldErrors;
    formError?: string | null;
    value?: T;
    hasValue?: boolean;
}
interface ValidationControllerDeps<T> {
    options: FormOptions<T>;
    getNestedValue: (obj: any, path: string) => unknown;
    isPathRelated: (a: string, b: string) => boolean;
    errors: Signal<FieldErrors>;
    formErrorSignal: Signal<string | null>;
}
export declare function isPromiseLike<TValue>(value: unknown): value is Promise<TValue>;
export declare function createValidationController<T>(deps: ValidationControllerDeps<T>): {
    validate: (data: T, opts?: {
        path?: string;
    }) => boolean | Promise<boolean>;
    validateForSubmit: (data: T) => {
        isValid: boolean;
        data: T;
    } | Promise<{
        isValid: boolean;
        data: T;
    }>;
};
export {};
