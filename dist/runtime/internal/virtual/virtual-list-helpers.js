export function readVirtualNumberOption(raw, ctx, label, deps) {
    if (!raw)
        return null;
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber))
        return asNumber;
    const fromCtx = ctx[trimmed];
    if (fromCtx === undefined) {
        deps.warn(`${label}: "${trimmed}" not found in context`);
        return null;
    }
    const resolved = deps.resolve(fromCtx);
    if (typeof resolved === 'number' && Number.isFinite(resolved))
        return resolved;
    const numericFromString = Number(resolved);
    if (Number.isFinite(numericFromString))
        return numericFromString;
    deps.warn(`${label}: "${trimmed}" must resolve to a finite number`);
    return null;
}
export function readVirtualHeightOption(raw, ctx, deps) {
    if (!raw)
        return null;
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber))
        return `${asNumber}px`;
    const fromCtx = ctx[trimmed];
    if (fromCtx !== undefined) {
        const resolved = deps.resolve(fromCtx);
        if (typeof resolved === 'number' && Number.isFinite(resolved))
            return `${resolved}px`;
        if (typeof resolved === 'string' && resolved.trim())
            return resolved.trim();
    }
    return trimmed;
}
export function readVirtualMeasureOption(raw, ctx, deps) {
    if (!raw)
        return false;
    const trimmed = raw.trim();
    if (!trimmed)
        return false;
    if (trimmed.toLowerCase() === 'auto')
        return true;
    const fromCtx = ctx[trimmed];
    if (fromCtx === undefined)
        return false;
    const resolved = deps.resolve(fromCtx);
    if (resolved === true)
        return true;
    if (typeof resolved === 'string' && resolved.trim().toLowerCase() === 'auto')
        return true;
    return false;
}
export function readVirtualCallbackOption(raw, ctx, label, deps) {
    if (!raw)
        return null;
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const fromCtx = ctx[trimmed];
    if (fromCtx === undefined) {
        deps.warn(`${label}: "${trimmed}" not found in context`);
        return null;
    }
    if (typeof fromCtx === 'function' && !deps.isSignal(fromCtx)) {
        return fromCtx;
    }
    if (deps.isSignal(fromCtx)) {
        const resolved = fromCtx();
        if (typeof resolved === 'function') {
            return resolved;
        }
    }
    deps.warn(`${label}: "${trimmed}" must resolve to a function`);
    return null;
}
export function createVirtualSpacer(template, kind) {
    const spacer = template.cloneNode(false);
    spacer.removeAttribute('id');
    spacer.removeAttribute('class');
    for (const attr of Array.from(spacer.attributes)) {
        if (attr.name.startsWith('d-')) {
            spacer.removeAttribute(attr.name);
        }
    }
    spacer.textContent = '';
    spacer.setAttribute('aria-hidden', 'true');
    spacer.setAttribute('data-dalila-virtual-spacer', kind);
    spacer.style.height = '0px';
    spacer.style.margin = '0';
    spacer.style.padding = '0';
    spacer.style.border = '0';
    spacer.style.pointerEvents = 'none';
    spacer.style.visibility = 'hidden';
    spacer.style.listStyle = 'none';
    return spacer;
}
const virtualScrollRestoreCache = new Map();
const VIRTUAL_SCROLL_RESTORE_CACHE_MAX_ENTRIES = 256;
export function getVirtualScrollRestoreValue(key) {
    const value = virtualScrollRestoreCache.get(key);
    if (value === undefined)
        return undefined;
    virtualScrollRestoreCache.delete(key);
    virtualScrollRestoreCache.set(key, value);
    return value;
}
export function setVirtualScrollRestoreValue(key, value) {
    virtualScrollRestoreCache.delete(key);
    virtualScrollRestoreCache.set(key, value);
    while (virtualScrollRestoreCache.size > VIRTUAL_SCROLL_RESTORE_CACHE_MAX_ENTRIES) {
        const oldestKey = virtualScrollRestoreCache.keys().next().value;
        if (!oldestKey)
            break;
        virtualScrollRestoreCache.delete(oldestKey);
    }
}
export function clampVirtual(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
export function getElementPositionPath(el) {
    const parts = [];
    let current = el;
    while (current) {
        const tag = current.tagName.toLowerCase();
        const parentEl = current.parentElement;
        if (!parentEl) {
            parts.push(tag);
            break;
        }
        let index = 1;
        let sib = current.previousElementSibling;
        while (sib) {
            index++;
            sib = sib.previousElementSibling;
        }
        parts.push(`${tag}:${index}`);
        current = parentEl;
    }
    return parts.reverse().join('>');
}
const virtualRestoreDocumentIds = new WeakMap();
let nextVirtualRestoreDocumentId = 0;
function getVirtualRestoreDocumentId(doc) {
    const existing = virtualRestoreDocumentIds.get(doc);
    if (existing !== undefined)
        return existing;
    const next = ++nextVirtualRestoreDocumentId;
    virtualRestoreDocumentIds.set(doc, next);
    return next;
}
export function getVirtualRestoreKey(doc, templatePath, scrollContainer, bindingName, keyBinding) {
    const locationPath = typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '';
    const containerIdentity = scrollContainer?.id
        ? `#${scrollContainer.id}`
        : (scrollContainer ? getElementPositionPath(scrollContainer) : '');
    const docId = getVirtualRestoreDocumentId(doc);
    return `${docId}|${locationPath}|${bindingName}|${keyBinding ?? ''}|${containerIdentity}|${templatePath}`;
}
export class VirtualHeightsIndex {
    constructor(itemCount, estimatedHeight) {
        this.itemCount = 0;
        this.estimatedHeight = 1;
        this.tree = [0];
        this.overrides = new Map();
        this.reset(itemCount, estimatedHeight);
    }
    get count() {
        return this.itemCount;
    }
    snapshotOverrides() {
        return new Map(this.overrides);
    }
    reset(itemCount, estimatedHeight, seed) {
        this.itemCount = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0;
        this.estimatedHeight = Number.isFinite(estimatedHeight) ? Math.max(1, estimatedHeight) : 1;
        this.tree = new Array(this.itemCount + 1).fill(0);
        this.overrides.clear();
        for (let i = 0; i < this.itemCount; i++) {
            this.addAt(i + 1, this.estimatedHeight);
        }
        if (!seed)
            return;
        for (const [index, height] of seed.entries()) {
            if (index < 0 || index >= this.itemCount)
                continue;
            this.set(index, height);
        }
    }
    set(index, height) {
        if (!Number.isFinite(height) || height <= 0)
            return false;
        if (index < 0 || index >= this.itemCount)
            return false;
        const next = Math.max(1, height);
        const current = this.get(index);
        if (Math.abs(next - current) < 0.5)
            return false;
        this.addAt(index + 1, next - current);
        if (Math.abs(next - this.estimatedHeight) < 0.5) {
            this.overrides.delete(index);
        }
        else {
            this.overrides.set(index, next);
        }
        return true;
    }
    get(index) {
        if (index < 0 || index >= this.itemCount)
            return this.estimatedHeight;
        return this.overrides.get(index) ?? this.estimatedHeight;
    }
    prefix(endExclusive) {
        if (endExclusive <= 0)
            return 0;
        const clampedEnd = Math.min(this.itemCount, Math.max(0, Math.floor(endExclusive)));
        let i = clampedEnd;
        let sum = 0;
        while (i > 0) {
            sum += this.tree[i];
            i -= i & -i;
        }
        return sum;
    }
    total() {
        return this.prefix(this.itemCount);
    }
    lowerBound(target) {
        if (this.itemCount === 0 || target <= 0)
            return 0;
        let idx = 0;
        let bit = 1;
        while ((bit << 1) <= this.itemCount)
            bit <<= 1;
        let sum = 0;
        while (bit > 0) {
            const next = idx + bit;
            if (next <= this.itemCount && sum + this.tree[next] < target) {
                idx = next;
                sum += this.tree[next];
            }
            bit >>= 1;
        }
        return Math.min(this.itemCount, idx);
    }
    indexAtOffset(offset) {
        if (this.itemCount === 0)
            return 0;
        if (!Number.isFinite(offset) || offset <= 0)
            return 0;
        const totalHeight = this.total();
        if (offset >= totalHeight)
            return this.itemCount - 1;
        const idx = this.lowerBound(offset + 0.0001);
        return clampVirtual(idx, 0, this.itemCount - 1);
    }
    addAt(treeIndex, delta) {
        let i = treeIndex;
        while (i <= this.itemCount) {
            this.tree[i] += delta;
            i += i & -i;
        }
    }
}
export function readVirtualListApi(target) {
    if (!target)
        return null;
    return target.__dalilaVirtualList ?? null;
}
export function setVirtualListApi(target, api) {
    if (!target)
        return;
    target.__dalilaVirtualList = api;
}
export function clearVirtualListApi(target, api) {
    if (!target)
        return;
    const host = target;
    if (host.__dalilaVirtualList === api) {
        delete host.__dalilaVirtualList;
    }
}
