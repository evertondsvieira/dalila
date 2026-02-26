type WarnFn = (message: string) => void;
export interface ListKeyResolverOptions {
    keyBinding: string | null;
    itemAliases?: string[];
    directiveName: 'd-each' | 'd-virtual-each';
    warn: WarnFn;
}
export interface ListKeyResolver {
    keyValueToString(value: unknown, index: number): string;
    readKeyValue(item: unknown, index: number): unknown;
}
export declare function createListKeyResolver(options: ListKeyResolverOptions): ListKeyResolver;
export {};
