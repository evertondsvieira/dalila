export type RuleFn<TValue = unknown, TValues = Record<string, unknown>> = (value: TValue, values: TValues) => string | boolean | null | undefined;
export interface RuleConfig<TValue = unknown, TValues = Record<string, unknown>> {
    rule: string | RuleFn<TValue, TValues>;
    value?: unknown;
    message?: string;
}
export type Rule<TValue = unknown, TValues = Record<string, unknown>> = string | RuleFn<TValue, TValues> | RuleConfig<TValue, TValues>;
export declare function normalizeRules<TValue = unknown, TValues = Record<string, unknown>>(rules: Array<Rule<TValue, TValues>>, _field?: string): Array<RuleFn<TValue, TValues>>;
export declare function validateValue<TValue = unknown, TValues = Record<string, unknown>>(value: TValue, values: TValues, validators: Array<RuleFn<TValue, TValues>>, _field?: string): string | null;
