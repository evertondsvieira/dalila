export declare function findFormFieldElement(formElement: HTMLFormElement | null, path: string): HTMLElement | null;
/**
 * Reset all `[d-field]` DOM controls to the provided defaults.
 * Keeps field arrays and meta-state handling to the caller.
 */
export declare function resetFormDomFields<T>(formElement: HTMLFormElement | null, defaultValues: Partial<T>): void;
