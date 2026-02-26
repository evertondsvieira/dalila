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

export function createListKeyResolver(options: ListKeyResolverOptions): ListKeyResolver {
  const { keyBinding, directiveName, warn } = options;
  const itemAliases = new Set(options.itemAliases ?? ['item']);
  itemAliases.add('item');

  const objectKeyIds = new WeakMap<object, number>();
  const symbolKeyIds = new Map<symbol, number>();
  let nextObjectKeyId = 0;
  let nextSymbolKeyId = 0;
  const missingKeyWarned = new Set<string>();

  const getObjectKeyId = (value: object): number => {
    const existing = objectKeyIds.get(value);
    if (existing !== undefined) return existing;
    const next = ++nextObjectKeyId;
    objectKeyIds.set(value, next);
    return next;
  };

  const keyValueToString = (value: unknown, index: number): string => {
    if (value === null || value === undefined) return `idx:${index}`;
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
      return `${type}:${String(value)}`;
    }
    if (type === 'symbol') {
      const sym = value as symbol;
      let id = symbolKeyIds.get(sym);
      if (id === undefined) {
        id = ++nextSymbolKeyId;
        symbolKeyIds.set(sym, id);
      }
      return `sym:${id}`;
    }
    if (type === 'object' || type === 'function') {
      return `obj:${getObjectKeyId(value as object)}`;
    }
    return `idx:${index}`;
  };

  const readKeyValue = (item: unknown, index: number): unknown => {
    if (keyBinding) {
      if (keyBinding === '$index') return index;
      if (itemAliases.has(keyBinding)) return item;
      if (typeof item === 'object' && item !== null && keyBinding in (item as Record<string, unknown>)) {
        return (item as Record<string, unknown>)[keyBinding];
      }
      const warnId = `${keyBinding}:${index}`;
      if (!missingKeyWarned.has(warnId)) {
        warn(`${directiveName}: key "${keyBinding}" not found on item at index ${index}. Falling back to index key.`);
        missingKeyWarned.add(warnId);
      }
      return index;
    }

    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      if ('id' in obj) return obj.id;
      if ('key' in obj) return obj.key;
    }
    return index;
  };

  return { keyValueToString, readKeyValue };
}
