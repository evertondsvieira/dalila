import { type Signal } from '../core/signal.js';
import type { Scope } from '../core/scope.js';
import type { FieldArray, FieldErrors } from './form-types.js';
export interface FieldArrayOptions {
    form: HTMLFormElement | null;
    scope: Scope | null;
    onMutate?: () => void;
    errors?: Signal<FieldErrors>;
    touchedSet?: Signal<Set<string>>;
    dirtySet?: Signal<Set<string>>;
}
export declare function createFieldArray<TItem = unknown>(basePath: string, options: FieldArrayOptions): FieldArray<TItem>;
