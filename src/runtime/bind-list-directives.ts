import { computeVirtualRange } from '../core/for.js';
import type { SchedulerPriority } from '../core/scheduler.js';
import { createListCloneRegistry } from './internal/list/list-clone-registry.js';
import { createListBoundCloneFactory } from './internal/list/list-clone-factory.js';
import { createListKeyResolver } from './internal/list/list-keying.js';
import { type ListItemMetadataSignals, updateListItemMetadata } from './internal/list/list-metadata.js';
import { insertOrderedClonesBefore, recreateChangedOrderedClones, removeMissingKeys } from './internal/list/list-reconcile.js';
import { createFrameRerender, createQueuedListRerender, runWithResolvedPriority } from './internal/list/list-scheduler.js';
import {
  clearVirtualListApi,
  clampVirtual,
  createVirtualSpacer,
  getElementPositionPath,
  getVirtualRestoreKey,
  getVirtualScrollRestoreValue,
  readVirtualCallbackOption,
  readVirtualHeightOption,
  readVirtualListApi,
  readVirtualMeasureOption,
  readVirtualNumberOption,
  setVirtualListApi,
  setVirtualScrollRestoreValue,
  VirtualHeightsIndex,
} from './internal/virtual/virtual-list-helpers.js';
import type {
  BindContext,
  BindOptions,
  DisposeFunction,
  VirtualListController,
  VirtualScrollToIndexOptions,
} from './bind.js';

interface BindListDirectiveDeps {
  qsaIncludingRoot: (root: Element, selector: string) => Element[];
  normalizeBinding: (raw: string | null) => string | null;
  warn: (message: string) => void;
  resolve: (value: unknown) => unknown;
  bind: (root: Element, ctx: BindContext, options: BindOptions) => (() => void);
  bindEffect: (target: Element | null | undefined, fn: () => void) => void;
  inheritNestedBindOptions: (parent: BindOptions, overrides: BindOptions) => BindOptions;
  isSignal: (value: unknown) => value is (() => unknown) & { set: unknown; update: unknown };
  resolveListRenderPriority: () => SchedulerPriority;
}

type VirtualListApi = VirtualListController;

export function getVirtualListController(target: Element | null): VirtualListController | null {
  return readVirtualListApi<VirtualListApi>(target);
}

export function scrollToVirtualIndex(
  target: Element | null,
  index: number,
  options?: VirtualScrollToIndexOptions
): boolean {
  const controller = readVirtualListApi<VirtualListApi>(target);
  if (!controller) return false;
  controller.scrollToIndex(index, options);
  return true;
}

export function bindVirtualEachDirective(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[],
  options: BindOptions,
  deps: BindListDirectiveDeps
): void {
  const elements = deps.qsaIncludingRoot(root, '[d-virtual-each]')
    .filter(el => !el.parentElement?.closest('[d-virtual-each], [d-each]'));

  for (const el of elements) {
    const bindingName = deps.normalizeBinding(el.getAttribute('d-virtual-each'));
    if (!bindingName) continue;

    const itemHeightBinding = deps.normalizeBinding(el.getAttribute('d-virtual-item-height'));
    const itemHeightRaw = itemHeightBinding ?? el.getAttribute('d-virtual-item-height');
    const itemHeightValue = readVirtualNumberOption(itemHeightRaw, ctx, 'd-virtual-item-height', { warn: deps.warn, resolve: deps.resolve });
    const fixedItemHeight = Number.isFinite(itemHeightValue as number) && (itemHeightValue as number) > 0
      ? (itemHeightValue as number)
      : NaN;

    const dynamicHeight = readVirtualMeasureOption(
      deps.normalizeBinding(el.getAttribute('d-virtual-measure')) ?? el.getAttribute('d-virtual-measure'),
      ctx,
      { resolve: deps.resolve }
    );

    if (!dynamicHeight && (!Number.isFinite(fixedItemHeight) || fixedItemHeight <= 0)) {
      deps.warn(`d-virtual-each: invalid item height on "${bindingName}". Falling back to d-each.`);
      el.setAttribute('d-each', bindingName);
      el.removeAttribute('d-virtual-each');
      el.removeAttribute('d-virtual-item-height');
      el.removeAttribute('d-virtual-estimated-height');
      el.removeAttribute('d-virtual-measure');
      el.removeAttribute('d-virtual-infinite');
      el.removeAttribute('d-virtual-overscan');
      el.removeAttribute('d-virtual-height');
      continue;
    }

    const estimatedHeightBinding = deps.normalizeBinding(el.getAttribute('d-virtual-estimated-height'));
    const estimatedHeightRaw = estimatedHeightBinding ?? el.getAttribute('d-virtual-estimated-height');
    const estimatedHeightValue = readVirtualNumberOption(
      estimatedHeightRaw,
      ctx,
      'd-virtual-estimated-height',
      { warn: deps.warn, resolve: deps.resolve }
    );
    const estimatedItemHeight = Number.isFinite(estimatedHeightValue as number) && (estimatedHeightValue as number) > 0
      ? (estimatedHeightValue as number)
      : (Number.isFinite(fixedItemHeight) ? fixedItemHeight : 48);

    const overscanBinding = deps.normalizeBinding(el.getAttribute('d-virtual-overscan'));
    const overscanRaw = overscanBinding ?? el.getAttribute('d-virtual-overscan');
    const overscanValue = readVirtualNumberOption(overscanRaw, ctx, 'd-virtual-overscan', { warn: deps.warn, resolve: deps.resolve });
    const overscan = Number.isFinite(overscanValue as number)
      ? Math.max(0, Math.floor(overscanValue as number))
      : 6;

    const viewportHeight = readVirtualHeightOption(
      deps.normalizeBinding(el.getAttribute('d-virtual-height')) ?? el.getAttribute('d-virtual-height'),
      ctx,
      { resolve: deps.resolve }
    );

    const onEndReached = readVirtualCallbackOption(
      deps.normalizeBinding(el.getAttribute('d-virtual-infinite')) ?? el.getAttribute('d-virtual-infinite'),
      ctx,
      'd-virtual-infinite',
      { warn: deps.warn, isSignal: deps.isSignal }
    );

    let binding = ctx[bindingName];
    if (binding === undefined) {
      deps.warn(`d-virtual-each: "${bindingName}" not found in context`);
      binding = [];
    }

    const templatePathBeforeDetach = getElementPositionPath(el);
    const comment = document.createComment('d-virtual-each');
    el.parentNode?.replaceChild(comment, el);
    el.removeAttribute('d-virtual-each');
    el.removeAttribute('d-virtual-item-height');
    el.removeAttribute('d-virtual-estimated-height');
    el.removeAttribute('d-virtual-measure');
    el.removeAttribute('d-virtual-infinite');
    el.removeAttribute('d-virtual-overscan');
    el.removeAttribute('d-virtual-height');

    const keyBinding = deps.normalizeBinding(el.getAttribute('d-key'));
    el.removeAttribute('d-key');

    const template = el;
    const topSpacer = createVirtualSpacer(template, 'top');
    const bottomSpacer = createVirtualSpacer(template, 'bottom');

    comment.parentNode?.insertBefore(topSpacer, comment);
    comment.parentNode?.insertBefore(bottomSpacer, comment);

    const scrollContainer = comment.parentElement as HTMLElement | null;
    if (scrollContainer) {
      if (viewportHeight) scrollContainer.style.height = viewportHeight;
      if (!scrollContainer.style.overflowY) scrollContainer.style.overflowY = 'auto';
    }

    const restoreKey = getVirtualRestoreKey(
      el.ownerDocument,
      templatePathBeforeDetach,
      scrollContainer,
      bindingName,
      keyBinding
    );
    const savedScrollTop = getVirtualScrollRestoreValue(restoreKey);
    if (scrollContainer && Number.isFinite(savedScrollTop as number)) {
      scrollContainer.scrollTop = Math.max(0, savedScrollTop as number);
    }

    const observedElements = new Set<Element>();
    let warnedNonArray = false;
    let warnedViewportFallback = false;
    let heightsIndex = dynamicHeight ? new VirtualHeightsIndex(0, estimatedItemHeight) : null;
    const { keyValueToString, readKeyValue } = createListKeyResolver({
      keyBinding,
      itemAliases: ['item'],
      directiveName: 'd-virtual-each',
      warn: deps.warn,
    });

    let rowResizeObserver: ResizeObserver | null = null;
    const registry = createListCloneRegistry<ListItemMetadataSignals>({
      onBeforeRemoveClone: (clone) => {
        if (rowResizeObserver && observedElements.has(clone)) {
          rowResizeObserver.unobserve(clone);
          observedElements.delete(clone);
        }
      },
    });
    const { clonesByKey, metadataByKey, itemsByKey } = registry;

    const createClone = createListBoundCloneFactory({
      template,
      parentCtx: ctx,
      alias: 'item',
      decorateClone: (clone, index) => {
        clone.setAttribute('data-dalila-virtual-index', String(index));
      },
      bindClone: (clone, itemCtx) => deps.bind(
        clone,
        itemCtx as BindContext,
        deps.inheritNestedBindOptions(options, { _skipLifecycle: true })
      ),
      register: registry.register,
    });

    function updateCloneMetadata(key: string, index: number, count: number): void {
      const metadata = metadataByKey.get(key);
      updateListItemMetadata(metadata, index, count);
      const clone = clonesByKey.get(key);
      if (clone) {
        clone.setAttribute('data-dalila-virtual-index', String(index));
      }
    }

    const removeKey = (key: string) => registry.removeKey(key);

    let currentItems: unknown[] = [];
    let lastEndReachedCount = -1;
    let endReachedPending = false;

    const remapDynamicHeights = (prevItems: unknown[], nextItems: unknown[]): void => {
      if (!dynamicHeight || !heightsIndex) return;

      const heightsByKey = new Map<string, number>();
      for (let i = 0; i < prevItems.length; i++) {
        const key = keyValueToString(readKeyValue(prevItems[i], i), i);
        if (!heightsByKey.has(key)) {
          heightsByKey.set(key, heightsIndex.get(i));
        }
      }

      heightsIndex.reset(nextItems.length, estimatedItemHeight);

      for (let i = 0; i < nextItems.length; i++) {
        const key = keyValueToString(readKeyValue(nextItems[i], i), i);
        const height = heightsByKey.get(key);
        if (height !== undefined) {
          heightsIndex.set(i, height);
        }
      }
    };

    const replaceItems = (nextItems: unknown[]): void => {
      remapDynamicHeights(currentItems, nextItems);
      currentItems = nextItems;
    };

    const maybeTriggerEndReached = (visibleEnd: number, totalCount: number) => {
      if (!onEndReached || totalCount === 0) return;
      if (visibleEnd < totalCount) return;
      if (lastEndReachedCount === totalCount || endReachedPending) return;

      lastEndReachedCount = totalCount;
      const result = onEndReached();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        endReachedPending = true;
        Promise.resolve(result)
          .catch(() => {})
          .finally(() => {
            endReachedPending = false;
          });
      }
    };

    function renderVirtualList(items: unknown[]): void {
      if (virtualListDisposed) return;
      const parent = comment.parentNode;
      if (!parent) return;

      if (dynamicHeight && heightsIndex && heightsIndex.count !== items.length) {
        heightsIndex.reset(items.length, estimatedItemHeight);
      }

      const viewportHeightValue = scrollContainer?.clientHeight ?? 0;
      const effectiveViewportHeight = viewportHeightValue > 0
        ? viewportHeightValue
        : (dynamicHeight ? estimatedItemHeight * 10 : fixedItemHeight * 10);
      const scrollTop = scrollContainer?.scrollTop ?? 0;

      if (viewportHeightValue <= 0 && !warnedViewportFallback) {
        warnedViewportFallback = true;
        deps.warn('d-virtual-each: scroll container has no measurable height. Using fallback viewport size.');
      }

      let start = 0;
      let end = 0;
      let topOffset = 0;
      let bottomOffset = 0;
      let totalHeight = 0;
      let visibleEndForEndReached = 0;

      if (dynamicHeight && heightsIndex) {
        totalHeight = heightsIndex.total();
        if (items.length > 0) {
          const visibleStart = heightsIndex.indexAtOffset(scrollTop);
          const visibleEnd = clampVirtual(
            heightsIndex.lowerBound(scrollTop + effectiveViewportHeight) + 1,
            visibleStart + 1,
            items.length
          );
          visibleEndForEndReached = visibleEnd;
          start = clampVirtual(visibleStart - overscan, 0, items.length);
          end = clampVirtual(visibleEnd + overscan, start, items.length);
          topOffset = heightsIndex.prefix(start);
          bottomOffset = Math.max(0, totalHeight - heightsIndex.prefix(end));
        }
      } else {
        const range = computeVirtualRange({
          itemCount: items.length,
          itemHeight: fixedItemHeight,
          scrollTop,
          viewportHeight: effectiveViewportHeight,
          overscan,
        });
        start = range.start;
        end = range.end;
        topOffset = range.topOffset;
        bottomOffset = range.bottomOffset;
        totalHeight = range.totalHeight;
        visibleEndForEndReached = clampVirtual(
          Math.ceil((scrollTop + effectiveViewportHeight) / fixedItemHeight),
          0,
          items.length
        );
      }

      topSpacer.style.height = `${topOffset}px`;
      bottomSpacer.style.height = `${bottomOffset}px`;
      topSpacer.setAttribute('data-dalila-virtual-total', String(totalHeight));

      const orderedClones: Element[] = [];
      const orderedKeys: string[] = [];
      const nextKeys = new Set<string>();
      const changedKeys = new Set<string>();

      for (let i = start; i < end; i++) {
        const item = items[i];
        let key = keyValueToString(readKeyValue(item, i), i);
        if (nextKeys.has(key)) {
          deps.warn(`d-virtual-each: duplicate visible key "${key}" at index ${i}. Falling back to per-index key.`);
          key = `${key}:dup:${i}`;
        }
        nextKeys.add(key);

        let clone = clonesByKey.get(key);
        if (clone) {
          updateCloneMetadata(key, i, items.length);
          if (itemsByKey.get(key) !== item) {
            changedKeys.add(key);
          }
        } else {
          clone = createClone(key, item, i, items.length);
        }

        orderedClones.push(clone);
        orderedKeys.push(key);
      }

      recreateChangedOrderedClones(orderedClones, orderedKeys, changedKeys, (key, orderedIndex) => {
        removeKey(key);
        return createClone(key, items[start + orderedIndex], start + orderedIndex, items.length);
      });

      removeMissingKeys(clonesByKey.keys(), nextKeys, removeKey);

      insertOrderedClonesBefore(parent, orderedClones, bottomSpacer);

      if (dynamicHeight && rowResizeObserver) {
        const nextObserved = new Set<Element>(orderedClones);
        for (const clone of Array.from(observedElements)) {
          if (nextObserved.has(clone)) continue;
          rowResizeObserver.unobserve(clone);
          observedElements.delete(clone);
        }
        for (const clone of orderedClones) {
          if (observedElements.has(clone)) continue;
          rowResizeObserver.observe(clone);
          observedElements.add(clone);
        }
      }

      maybeTriggerEndReached(visibleEndForEndReached, items.length);
    }

    let framePending = false;
    let virtualListDisposed = false;
    const scheduleRender = createFrameRerender({
      resolvePriority: deps.resolveListRenderPriority,
      isDisposed: () => virtualListDisposed,
      isPending: () => framePending,
      setPending: (pending) => { framePending = pending; },
      render: () => renderVirtualList(currentItems),
    });

    const onScroll = () => scheduleRender();
    const onResize = () => scheduleRender();

    scrollContainer?.addEventListener('scroll', onScroll, { passive: true });

    let containerResizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && scrollContainer) {
      containerResizeObserver = new ResizeObserver(() => {
        if (virtualListDisposed) return;
        scheduleRender();
      });
      containerResizeObserver.observe(scrollContainer);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', onResize);
    }

    if (dynamicHeight && typeof ResizeObserver !== 'undefined' && heightsIndex) {
      rowResizeObserver = new ResizeObserver((entries) => {
        if (virtualListDisposed) return;
        let changed = false;
        for (const entry of entries) {
          const target = entry.target as Element;
          const indexRaw = target.getAttribute('data-dalila-virtual-index');
          if (!indexRaw) continue;
          const index = Number(indexRaw);
          if (!Number.isFinite(index)) continue;
          const measured = entry.contentRect?.height;
          if (!Number.isFinite(measured) || measured <= 0) continue;
          changed = heightsIndex.set(index, measured) || changed;
        }
        if (changed) scheduleRender();
      });
    }

    const scrollToIndex = (
      index: number,
      options?: VirtualScrollToIndexOptions
    ) => {
      if (!scrollContainer || currentItems.length === 0) return;
      const safeIndex = clampVirtual(Math.floor(index), 0, currentItems.length - 1);
      const viewportSize = scrollContainer.clientHeight > 0
        ? scrollContainer.clientHeight
        : (dynamicHeight ? estimatedItemHeight * 10 : fixedItemHeight * 10);
      const align = options?.align ?? 'start';

      let top = dynamicHeight && heightsIndex
        ? heightsIndex.prefix(safeIndex)
        : safeIndex * fixedItemHeight;
      const itemSize = dynamicHeight && heightsIndex
        ? heightsIndex.get(safeIndex)
        : fixedItemHeight;

      if (align === 'center') {
        top = top - (viewportSize / 2) + (itemSize / 2);
      } else if (align === 'end') {
        top = top - viewportSize + itemSize;
      }
      top = Math.max(0, top);

      if (options?.behavior && typeof scrollContainer.scrollTo === 'function') {
        scrollContainer.scrollTo({ top, behavior: options.behavior });
      } else {
        scrollContainer.scrollTop = top;
      }
      scheduleRender();
    };

    const virtualApi: VirtualListApi = {
      scrollToIndex,
      refresh: scheduleRender,
    };

    if (scrollContainer) {
      setVirtualListApi(scrollContainer, virtualApi);
    }

    if (deps.isSignal(binding)) {
      let hasRenderedInitialSignalPass = false;
      deps.bindEffect(scrollContainer ?? el, () => {
        const value = binding();
        if (Array.isArray(value)) {
          warnedNonArray = false;
          replaceItems(value);
        } else {
          if (!warnedNonArray) {
            warnedNonArray = true;
            deps.warn(`d-virtual-each: "${bindingName}" is not an array or signal-of-array`);
          }
          replaceItems([]);
        }
        if (!hasRenderedInitialSignalPass) {
          hasRenderedInitialSignalPass = true;
          runWithResolvedPriority(deps.resolveListRenderPriority, () => renderVirtualList(currentItems));
          return;
        }
        scheduleRender();
      });
    } else if (Array.isArray(binding)) {
      replaceItems(binding);
      runWithResolvedPriority(deps.resolveListRenderPriority, () => renderVirtualList(currentItems));
    } else {
      deps.warn(`d-virtual-each: "${bindingName}" is not an array or signal-of-array`);
    }

    cleanups.push(() => {
      virtualListDisposed = true;
      framePending = false;
      scrollContainer?.removeEventListener('scroll', onScroll);
      if (containerResizeObserver) {
        containerResizeObserver.disconnect();
      } else if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onResize);
      }
      if (rowResizeObserver) {
        rowResizeObserver.disconnect();
      }
      observedElements.clear();
      if (scrollContainer) {
        setVirtualScrollRestoreValue(restoreKey, scrollContainer.scrollTop);
        clearVirtualListApi(scrollContainer, virtualApi);
      }
      for (const key of Array.from(clonesByKey.keys())) removeKey(key);
      topSpacer.remove();
      bottomSpacer.remove();
    });
  }
}

export function bindEachDirective(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[],
  options: BindOptions,
  deps: BindListDirectiveDeps
): void {
  const elements = deps.qsaIncludingRoot(root, '[d-each]')
    .filter(el => !el.parentElement?.closest('[d-each], [d-virtual-each]'));

  for (const el of elements) {
    const rawValue = el.getAttribute('d-each')?.trim() ?? '';
    let bindingName: string | null;
    let alias = 'item';
    const asMatch = rawValue.match(/^(\S+)\s+as\s+(\S+)$/);
    if (asMatch) {
      bindingName = deps.normalizeBinding(asMatch[1]);
      alias = asMatch[2];
    } else {
      bindingName = deps.normalizeBinding(rawValue);
    }
    if (!bindingName) continue;

    let binding = ctx[bindingName];
    if (binding === undefined) {
      deps.warn(`d-each: "${bindingName}" not found in context`);
      binding = [];
    }

    const comment = document.createComment('d-each');
    el.parentNode?.replaceChild(comment, el);
    el.removeAttribute('d-each');
    const keyBinding = deps.normalizeBinding(el.getAttribute('d-key'));
    el.removeAttribute('d-key');

    const template = el;
    const registry = createListCloneRegistry<ListItemMetadataSignals>();
    const { clonesByKey, metadataByKey, itemsByKey } = registry;
    const { keyValueToString, readKeyValue } = createListKeyResolver({
      keyBinding,
      itemAliases: [alias, 'item'],
      directiveName: 'd-each',
      warn: deps.warn,
    });

    const createClone = createListBoundCloneFactory({
      template,
      parentCtx: ctx,
      alias,
      bindClone: (clone, itemCtx) => deps.bind(
        clone,
        itemCtx as BindContext,
        deps.inheritNestedBindOptions(options, { _skipLifecycle: true })
      ),
      register: registry.register,
    });

    function updateCloneMetadata(key: string, index: number, count: number): void {
      const metadata = metadataByKey.get(key);
      updateListItemMetadata(metadata, index, count);
    }

    function renderList(items: unknown[]) {
      const orderedClones: Element[] = [];
      const orderedKeys: string[] = [];
      const nextKeys = new Set<string>();
      const changedKeys = new Set<string>();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let key = keyValueToString(readKeyValue(item, i), i);
        if (nextKeys.has(key)) {
          deps.warn(`d-each: duplicate key "${key}" at index ${i}. Falling back to per-index key.`);
          key = `${key}:dup:${i}`;
        }
        nextKeys.add(key);

        let clone = clonesByKey.get(key);
        if (clone) {
          updateCloneMetadata(key, i, items.length);
          if (itemsByKey.get(key) !== item) {
            changedKeys.add(key);
          }
        } else {
          clone = createClone(key, item, i, items.length);
        }

        orderedClones.push(clone);
        orderedKeys.push(key);
      }

      const removeKey = (key: string): void => registry.removeKey(key);

      recreateChangedOrderedClones(orderedClones, orderedKeys, changedKeys, (key, orderedIndex) => {
        removeKey(key);
        return createClone(key, items[orderedIndex], orderedIndex, items.length);
      });

      removeMissingKeys(clonesByKey.keys(), nextKeys, removeKey);

      const parent = comment.parentNode;
      if (!parent) return;

      insertOrderedClonesBefore(parent, orderedClones, comment);
    }

    let lowPriorityRenderQueued = false;
    let listRenderDisposed = false;
    const scheduleLowPriorityListRender = createQueuedListRerender<unknown[]>({
      resolvePriority: deps.resolveListRenderPriority,
      isDisposed: () => listRenderDisposed,
      isQueued: () => lowPriorityRenderQueued,
      setQueued: (queued) => { lowPriorityRenderQueued = queued; },
      render: renderList,
    });

    if (deps.isSignal(binding)) {
      let hasRenderedInitialSignalPass = false;
      deps.bindEffect(el, () => {
        const value = binding();
        const items = Array.isArray(value) ? value : [];
        if (!hasRenderedInitialSignalPass) {
          hasRenderedInitialSignalPass = true;
          runWithResolvedPriority(deps.resolveListRenderPriority, () => renderList(items));
          return;
        }
        scheduleLowPriorityListRender(items);
      });
    } else if (Array.isArray(binding)) {
      runWithResolvedPriority(deps.resolveListRenderPriority, () => renderList(binding));
    } else {
      deps.warn(`d-each: "${bindingName}" is not an array or signal`);
    }

    cleanups.push(() => {
      listRenderDisposed = true;
      lowPriorityRenderQueued = false;
      registry.cleanup();
    });
  }
}
