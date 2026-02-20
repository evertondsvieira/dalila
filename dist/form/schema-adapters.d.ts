import type { FormSchemaAdapter } from "./form-types.js";
interface ValibotRuntime {
    safeParseAsync?: (schema: unknown, input: unknown) => Promise<unknown>;
    safeParse?: (schema: unknown, input: unknown) => unknown;
    parseAsync?: (schema: unknown, input: unknown) => Promise<unknown>;
    parse?: (schema: unknown, input: unknown) => unknown;
}
declare global {
    var valibot: ValibotRuntime | undefined;
}
export declare function zodAdapter<T = unknown>(schema: unknown): FormSchemaAdapter<T>;
export declare function valibotAdapter<T = unknown>(schema: unknown, runtime?: ValibotRuntime): FormSchemaAdapter<T>;
export declare function yupAdapter<T = unknown>(schema: unknown): FormSchemaAdapter<T>;
export {};
