import { effect, signal } from './signal.js';
import { measure, mutate } from './scheduler.js';
import { getCurrentScope } from './scope.js';
// Experimental: virtualized list rendering API.
export function createVirtualList(items, itemHeight, renderItem, options) {
    const container = options.container;
    const bufferSize = options.bufferSize || 3;
    const keyFn = options.keyFn || ((item, index) => index.toString());
    let visibleItems = [];
    let allItems = [];
    let scrollTop = 0;
    let containerHeight = 0;
    let totalHeight = 0;
    let itemHeights = [];
    const contentContainer = document.createElement('div');
    container.appendChild(contentContainer);
    // Calculate item height
    const getItemHeight = (item, index) => {
        if (typeof itemHeight === 'function') {
            return itemHeight(item, index);
        }
        return itemHeight;
    };
    // Update item heights and total height
    const updateItemHeights = () => {
        itemHeights = allItems.map((item, index) => getItemHeight(item, index));
        totalHeight = itemHeights.reduce((sum, height) => sum + height, 0);
    };
    // Calculate visible range
    const calculateVisibleRange = () => {
        const startIndex = Math.max(0, Math.floor(scrollTop / averageItemHeight()) - bufferSize);
        const endIndex = Math.min(allItems.length - 1, Math.ceil((scrollTop + containerHeight) / averageItemHeight()) + bufferSize);
        return { startIndex, endIndex };
    };
    // Calculate average item height for estimation
    const averageItemHeight = () => {
        if (itemHeights.length === 0)
            return itemHeight instanceof Function ? 50 : itemHeight;
        return itemHeights.reduce((sum, height) => sum + height, 0) / itemHeights.length;
    };
    // Render visible items
    const renderVisibleItems = () => {
        measure(() => {
            const { startIndex, endIndex } = calculateVisibleRange();
            // Remove items that are no longer visible
            visibleItems.forEach(item => {
                if (item.index < startIndex || item.index > endIndex) {
                    if (item.element.parentNode) {
                        item.element.parentNode.removeChild(item.element);
                    }
                }
            });
            // Filter visible items
            visibleItems = visibleItems.filter(item => item.index >= startIndex && item.index <= endIndex);
            // Add new visible items
            for (let i = startIndex; i <= endIndex; i++) {
                const existingItem = visibleItems.find(item => item.index === i);
                if (!existingItem) {
                    const item = allItems[i];
                    const element = renderItem(item, i);
                    const height = getItemHeight(item, i);
                    // Calculate position
                    const top = itemHeights.slice(0, i).reduce((sum, h) => sum + h, 0);
                    // Style the element
                    element.style.position = 'absolute';
                    element.style.top = `${top}px`;
                    element.style.height = `${height}px`;
                    element.style.width = '100%';
                    element.setAttribute('data-key', keyFn(item, i));
                    contentContainer.appendChild(element);
                    visibleItems.push({
                        index: i,
                        item,
                        top,
                        height,
                        element
                    });
                }
            }
        });
    };
    // Update container and scroll position
    const updateContainer = () => {
        mutate(() => {
            if (!container.style.position || container.style.position === 'static') {
                container.style.position = 'relative';
            }
            container.style.overflow = 'auto';
            contentContainer.style.position = 'relative';
            contentContainer.style.height = `${totalHeight}px`;
            contentContainer.style.width = '100%';
        });
    };
    // Handle scroll events (rAF throttled)
    let scrollRafId = null;
    const handleScroll = () => {
        if (scrollRafId !== null)
            return;
        scrollRafId = requestAnimationFrame(() => {
            scrollRafId = null;
            scrollTop = container.scrollTop;
            containerHeight = container.clientHeight;
            renderVisibleItems();
        });
    };
    // Initialize
    effect(() => {
        allItems = items();
        updateItemHeights();
        updateContainer();
        renderVisibleItems();
    });
    // Set up scroll listener
    container.addEventListener('scroll', handleScroll);
    // Initial render
    containerHeight = container.clientHeight;
    renderVisibleItems();
    // Cleanup
    const scope = getCurrentScope();
    if (scope) {
        scope.onCleanup(() => {
            container.removeEventListener('scroll', handleScroll);
            if (scrollRafId !== null)
                cancelAnimationFrame(scrollRafId);
            contentContainer.innerHTML = '';
            if (contentContainer.parentNode) {
                contentContainer.parentNode.removeChild(contentContainer);
            }
        });
    }
}
// Simplified virtual list for fixed height items
export function createSimpleVirtualList(items, itemHeight, renderItem, container, bufferSize = 3) {
    createVirtualList(items, itemHeight, renderItem, { container, bufferSize });
}
// Virtual table implementation
export function createVirtualTable(data, columns, renderCell, container, rowHeight = 50, bufferSize = 3) {
    const headerHeight = 40;
    const totalWidth = columns.reduce((sum, col) => sum + parseInt(col.width), 0);
    // Create header
    const header = document.createElement('div');
    header.style.position = 'absolute';
    header.style.top = '0';
    header.style.left = '0';
    header.style.width = `${totalWidth}px`;
    header.style.height = `${headerHeight}px`;
    header.style.display = 'flex';
    header.style.backgroundColor = '#f5f5f5';
    header.style.zIndex = '10';
    columns.forEach(col => {
        const headerCell = document.createElement('div');
        headerCell.textContent = col.header;
        headerCell.style.width = col.width;
        headerCell.style.height = `${headerHeight}px`;
        headerCell.style.display = 'flex';
        headerCell.style.alignItems = 'center';
        headerCell.style.padding = '0 8px';
        headerCell.style.boxSizing = 'border-box';
        headerCell.style.borderRight = '1px solid #ddd';
        header.appendChild(headerCell);
    });
    container.appendChild(header);
    // Create scrollable content area
    const contentContainer = document.createElement('div');
    contentContainer.style.position = 'absolute';
    contentContainer.style.top = `${headerHeight}px`;
    contentContainer.style.left = '0';
    contentContainer.style.width = `${totalWidth}px`;
    contentContainer.style.height = `calc(100% - ${headerHeight}px)`;
    contentContainer.style.overflow = 'auto';
    container.appendChild(contentContainer);
    container.style.position = 'relative';
    container.style.height = '100%';
    container.style.width = `${totalWidth}px`;
    // Render rows
    createVirtualList(data, rowHeight, (item, index) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.width = '100%';
        row.style.height = `${rowHeight}px`;
        row.style.borderBottom = '1px solid #eee';
        columns.forEach(col => {
            const cell = renderCell(item, col, index);
            cell.style.width = col.width;
            cell.style.height = `${rowHeight}px`;
            cell.style.display = 'flex';
            cell.style.alignItems = 'center';
            cell.style.padding = '0 8px';
            cell.style.boxSizing = 'border-box';
            cell.style.borderRight = '1px solid #ddd';
            row.appendChild(cell);
        });
        return row;
    }, {
        container: contentContainer,
        bufferSize,
        keyFn: (item) => JSON.stringify(item)
    });
}
// Infinite scroll implementation
export function createInfiniteScroll(fetchFn, renderItem, container, options = {}) {
    const itemHeight = options.itemHeight || 100;
    const bufferSize = options.bufferSize || 3;
    const initialLoad = options.initialLoad || 20;
    const loadMoreThreshold = options.loadMoreThreshold || 5;
    const items = signal([]);
    const loading = signal(false);
    const error = signal(null);
    const offset = signal(0);
    const hasMore = signal(true);
    let isLoading = false;
    let allItems = [];
    async function loadMore() {
        if (isLoading || !hasMore())
            return;
        isLoading = true;
        loading.set(true);
        error.set(null);
        try {
            const newItems = await fetchFn(offset(), initialLoad);
            if (newItems.length === 0) {
                hasMore.set(false);
            }
            else {
                allItems = [...allItems, ...newItems];
                items.set(allItems);
                offset.set(offset() + newItems.length);
            }
        }
        catch (err) {
            error.set(err instanceof Error ? err : new Error(String(err)));
        }
        finally {
            isLoading = false;
            loading.set(false);
        }
    }
    async function refresh() {
        offset.set(0);
        hasMore.set(true);
        allItems = [];
        items.set([]);
        await loadMore();
    }
    // Initial load
    effect(() => {
        loadMore();
    });
    // Set up scroll listener for infinite scroll
    container.addEventListener('scroll', () => {
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight;
        const clientHeight = container.clientHeight;
        if (scrollHeight - (scrollTop + clientHeight) < loadMoreThreshold * itemHeight) {
            loadMore();
        }
    });
    // Render items
    createVirtualList(items, itemHeight, renderItem, {
        container,
        bufferSize,
        keyFn: (item) => `${JSON.stringify(item)}`
    });
    // Cleanup
    const scope = getCurrentScope();
    if (scope) {
        scope.onCleanup(() => {
            container.innerHTML = '';
        });
    }
    return {
        items: () => items(),
        loading: () => loading(),
        error: () => error(),
        refresh
    };
}
