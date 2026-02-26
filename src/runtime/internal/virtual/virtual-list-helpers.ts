type WarnFn = (message: string) => void;
type ResolveFn = (value: unknown) => unknown;
type IsSignalLikeFn = (value: unknown) => boolean;
type VirtualListApiLike = { scrollToIndex: (index: number, options?: any) => void; refresh: () => void };

export function readVirtualNumberOption(
  raw: string | null,
  ctx: Record<string, unknown>,
  label: string,
  deps: { warn: WarnFn; resolve: ResolveFn }
): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return asNumber;

  const fromCtx = ctx[trimmed];
  if (fromCtx === undefined) {
    deps.warn(`${label}: "${trimmed}" not found in context`);
    return null;
  }

  const resolved = deps.resolve(fromCtx);
  if (typeof resolved === 'number' && Number.isFinite(resolved)) return resolved;

  const numericFromString = Number(resolved);
  if (Number.isFinite(numericFromString)) return numericFromString;

  deps.warn(`${label}: "${trimmed}" must resolve to a finite number`);
  return null;
}

export function readVirtualHeightOption(
  raw: string | null,
  ctx: Record<string, unknown>,
  deps: { resolve: ResolveFn }
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return `${asNumber}px`;

  const fromCtx = ctx[trimmed];
  if (fromCtx !== undefined) {
    const resolved = deps.resolve(fromCtx);
    if (typeof resolved === 'number' && Number.isFinite(resolved)) return `${resolved}px`;
    if (typeof resolved === 'string' && resolved.trim()) return resolved.trim();
  }

  return trimmed;
}

export function readVirtualMeasureOption(
  raw: string | null,
  ctx: Record<string, unknown>,
  deps: { resolve: ResolveFn }
): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase() === 'auto') return true;

  const fromCtx = ctx[trimmed];
  if (fromCtx === undefined) return false;
  const resolved = deps.resolve(fromCtx);
  if (resolved === true) return true;
  if (typeof resolved === 'string' && resolved.trim().toLowerCase() === 'auto') return true;
  return false;
}

export function readVirtualCallbackOption(
  raw: string | null,
  ctx: Record<string, unknown>,
  label: string,
  deps: { warn: WarnFn; isSignal: IsSignalLikeFn }
): (() => unknown) | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fromCtx = ctx[trimmed];
  if (fromCtx === undefined) {
    deps.warn(`${label}: "${trimmed}" not found in context`);
    return null;
  }

  if (typeof fromCtx === 'function' && !deps.isSignal(fromCtx)) {
    return fromCtx as () => unknown;
  }

  if (deps.isSignal(fromCtx)) {
    const resolved = (fromCtx as () => unknown)();
    if (typeof resolved === 'function') {
      return resolved as () => unknown;
    }
  }

  deps.warn(`${label}: "${trimmed}" must resolve to a function`);
  return null;
}

export function createVirtualSpacer(template: Element, kind: 'top' | 'bottom'): HTMLElement {
  const spacer = template.cloneNode(false) as HTMLElement;

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

const virtualScrollRestoreCache = new Map<string, number>();
const VIRTUAL_SCROLL_RESTORE_CACHE_MAX_ENTRIES = 256;

export function getVirtualScrollRestoreValue(key: string): number | undefined {
  const value = virtualScrollRestoreCache.get(key);
  if (value === undefined) return undefined;
  virtualScrollRestoreCache.delete(key);
  virtualScrollRestoreCache.set(key, value);
  return value;
}

export function setVirtualScrollRestoreValue(key: string, value: number): void {
  virtualScrollRestoreCache.delete(key);
  virtualScrollRestoreCache.set(key, value);
  while (virtualScrollRestoreCache.size > VIRTUAL_SCROLL_RESTORE_CACHE_MAX_ENTRIES) {
    const oldestKey = virtualScrollRestoreCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    virtualScrollRestoreCache.delete(oldestKey);
  }
}

export function clampVirtual(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getElementPositionPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current) {
    const tag = current.tagName.toLowerCase();
    const parentEl: Element | null = current.parentElement;
    if (!parentEl) {
      parts.push(tag);
      break;
    }

    let index = 1;
    let sib: Element | null = current.previousElementSibling;
    while (sib) {
      index++;
      sib = sib.previousElementSibling;
    }

    parts.push(`${tag}:${index}`);
    current = parentEl;
  }

  return parts.reverse().join('>');
}

const virtualRestoreDocumentIds = new WeakMap<Document, number>();
let nextVirtualRestoreDocumentId = 0;

function getVirtualRestoreDocumentId(doc: Document): number {
  const existing = virtualRestoreDocumentIds.get(doc);
  if (existing !== undefined) return existing;
  const next = ++nextVirtualRestoreDocumentId;
  virtualRestoreDocumentIds.set(doc, next);
  return next;
}

export function getVirtualRestoreKey(
  doc: Document,
  templatePath: string,
  scrollContainer: HTMLElement | null,
  bindingName: string,
  keyBinding: string | null
): string {
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
  private itemCount = 0;
  private estimatedHeight = 1;
  private tree: number[] = [0];
  private overrides = new Map<number, number>();

  constructor(itemCount: number, estimatedHeight: number) {
    this.reset(itemCount, estimatedHeight);
  }

  get count(): number {
    return this.itemCount;
  }

  snapshotOverrides(): Map<number, number> {
    return new Map(this.overrides);
  }

  reset(itemCount: number, estimatedHeight: number, seed?: Map<number, number>): void {
    this.itemCount = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0;
    this.estimatedHeight = Number.isFinite(estimatedHeight) ? Math.max(1, estimatedHeight) : 1;
    this.tree = new Array(this.itemCount + 1).fill(0);
    this.overrides.clear();

    for (let i = 0; i < this.itemCount; i++) {
      this.addAt(i + 1, this.estimatedHeight);
    }

    if (!seed) return;
    for (const [index, height] of seed.entries()) {
      if (index < 0 || index >= this.itemCount) continue;
      this.set(index, height);
    }
  }

  set(index: number, height: number): boolean {
    if (!Number.isFinite(height) || height <= 0) return false;
    if (index < 0 || index >= this.itemCount) return false;

    const next = Math.max(1, height);
    const current = this.get(index);
    if (Math.abs(next - current) < 0.5) return false;

    this.addAt(index + 1, next - current);
    if (Math.abs(next - this.estimatedHeight) < 0.5) {
      this.overrides.delete(index);
    } else {
      this.overrides.set(index, next);
    }
    return true;
  }

  get(index: number): number {
    if (index < 0 || index >= this.itemCount) return this.estimatedHeight;
    return this.overrides.get(index) ?? this.estimatedHeight;
  }

  prefix(endExclusive: number): number {
    if (endExclusive <= 0) return 0;
    const clampedEnd = Math.min(this.itemCount, Math.max(0, Math.floor(endExclusive)));
    let i = clampedEnd;
    let sum = 0;
    while (i > 0) {
      sum += this.tree[i];
      i -= i & -i;
    }
    return sum;
  }

  total(): number {
    return this.prefix(this.itemCount);
  }

  lowerBound(target: number): number {
    if (this.itemCount === 0 || target <= 0) return 0;

    let idx = 0;
    let bit = 1;
    while ((bit << 1) <= this.itemCount) bit <<= 1;

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

  indexAtOffset(offset: number): number {
    if (this.itemCount === 0) return 0;
    if (!Number.isFinite(offset) || offset <= 0) return 0;
    const totalHeight = this.total();
    if (offset >= totalHeight) return this.itemCount - 1;
    const idx = this.lowerBound(offset + 0.0001);
    return clampVirtual(idx, 0, this.itemCount - 1);
  }

  private addAt(treeIndex: number, delta: number): void {
    let i = treeIndex;
    while (i <= this.itemCount) {
      this.tree[i] += delta;
      i += i & -i;
    }
  }
}

type VirtualHostElement = HTMLElement & { __dalilaVirtualList?: VirtualListApiLike };

export function readVirtualListApi<T extends VirtualListApiLike>(target: Element | null): T | null {
  if (!target) return null;
  return ((target as VirtualHostElement).__dalilaVirtualList as T | undefined) ?? null;
}

export function setVirtualListApi(target: HTMLElement | null, api: VirtualListApiLike): void {
  if (!target) return;
  (target as VirtualHostElement).__dalilaVirtualList = api;
}

export function clearVirtualListApi(target: HTMLElement | null, api: VirtualListApiLike): void {
  if (!target) return;
  const host = target as VirtualHostElement;
  if (host.__dalilaVirtualList === api) {
    delete host.__dalilaVirtualList;
  }
}
