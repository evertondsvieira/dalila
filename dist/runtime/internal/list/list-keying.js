export function createListKeyResolver(options) {
    const { keyBinding, directiveName, warn } = options;
    const itemAliases = new Set(options.itemAliases ?? ['item']);
    itemAliases.add('item');
    const objectKeyIds = new WeakMap();
    const symbolKeyIds = new Map();
    let nextObjectKeyId = 0;
    let nextSymbolKeyId = 0;
    const missingKeyWarned = new Set();
    const getObjectKeyId = (value) => {
        const existing = objectKeyIds.get(value);
        if (existing !== undefined)
            return existing;
        const next = ++nextObjectKeyId;
        objectKeyIds.set(value, next);
        return next;
    };
    const keyValueToString = (value, index) => {
        if (value === null || value === undefined)
            return `idx:${index}`;
        const type = typeof value;
        if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
            return `${type}:${String(value)}`;
        }
        if (type === 'symbol') {
            const sym = value;
            let id = symbolKeyIds.get(sym);
            if (id === undefined) {
                id = ++nextSymbolKeyId;
                symbolKeyIds.set(sym, id);
            }
            return `sym:${id}`;
        }
        if (type === 'object' || type === 'function') {
            return `obj:${getObjectKeyId(value)}`;
        }
        return `idx:${index}`;
    };
    const readKeyValue = (item, index) => {
        if (keyBinding) {
            if (keyBinding === '$index')
                return index;
            if (itemAliases.has(keyBinding))
                return item;
            if (typeof item === 'object' && item !== null && keyBinding in item) {
                return item[keyBinding];
            }
            const warnId = `${keyBinding}:${index}`;
            if (!missingKeyWarned.has(warnId)) {
                warn(`${directiveName}: key "${keyBinding}" not found on item at index ${index}. Falling back to index key.`);
                missingKeyWarned.add(warnId);
            }
            return index;
        }
        if (typeof item === 'object' && item !== null) {
            const obj = item;
            if ('id' in obj)
                return obj.id;
            if ('key' in obj)
                return obj.key;
        }
        return index;
    };
    return { keyValueToString, readKeyValue };
}
