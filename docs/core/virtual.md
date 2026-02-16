# Virtual Lists

Dalila supports virtualized list rendering for very large collections.

Use this when rendering thousands of rows and you want a bounded DOM size.

## 1. Runtime Directive: `d-virtual-each`

### Fixed height (fast-path)

```html
<div class="viewport">
  <article
    d-virtual-each="items"
    d-virtual-item-height="48"
    d-virtual-overscan="4"
    d-key="id"
  >
    <h4>{title}</h4>
    <p>{summary}</p>
  </article>
</div>
```

### Dynamic height (auto measure)

```html
<div class="viewport">
  <article
    d-virtual-each="items"
    d-virtual-measure="auto"
    d-virtual-estimated-height="48"
    d-virtual-overscan="4"
    d-key="id"
  >
    <h4>{title}</h4>
    <p>{summary}</p>
  </article>
</div>
```

### Infinite scroll callback

```html
<div class="viewport">
  <article
    d-virtual-each="items"
    d-virtual-item-height="48"
    d-virtual-infinite="loadMore"
    d-key="id"
  >
    {title}
  </article>
</div>
```

### Required attributes

- `d-virtual-each`: array or signal-of-array from context.
- Choose one sizing mode:
- `d-virtual-item-height` for fixed row height.
- `d-virtual-measure="auto"` for dynamic row measurement.

### Optional attributes

- `d-virtual-overscan`: extra rows before/after viewport. Default: `6`.
- `d-virtual-height`: CSS height for the parent scroll container (`"400px"`, `"60vh"`, or context value).
- `d-virtual-estimated-height`: fallback height used before measurement in dynamic mode.
- `d-virtual-infinite`: callback called when the visible window reaches the end.
- `d-key`: stable key field (recommended for reordering and updates).

### Notes

- The parent element is treated as the scroll container.
- Windowing is always partial rendering (visible range + overscan only).
- In dynamic mode, Dalila uses `ResizeObserver` to keep per-item heights updated.
- If fixed mode has invalid `d-virtual-item-height`, Dalila falls back to `d-each`.

## 2. Programmatic Scrolling

Use the runtime helper to scroll to a target row index.

```ts
import { scrollToVirtualIndex } from "dalila/runtime";

scrollToVirtualIndex(viewportEl, 50, { align: "start" });
```

You can also fetch the controller:

```ts
import { getVirtualListController } from "dalila/runtime";

const virtual = getVirtualListController(viewportEl);
virtual?.scrollToIndex(50, { align: "center" });
virtual?.refresh();
```

## 3. Core Helper: `computeVirtualRange`

For custom renderers, use the range engine directly.

```ts
import { computeVirtualRange } from "dalila";

const range = computeVirtualRange({
  itemCount: 100_000,
  itemHeight: 40,
  scrollTop: 12_000,
  viewportHeight: 640,
  overscan: 6,
});

// range.start / range.end is [start, end)
```

Returned shape:

```ts
{
  start: number;
  end: number;
  topOffset: number;
  bottomOffset: number;
  totalHeight: number;
}
```

`computeVirtualRange` is for fixed-height lists.

## 4. Performance Guidance

- Keep item templates lightweight.
- Prefer `d-key` with stable unique values.
- Prefer fixed mode (`d-virtual-item-height`) whenever heights are truly uniform.
- Use dynamic mode only when row heights actually vary.
- Tune `d-virtual-overscan`:
  - lower = less DOM, more mount/unmount
  - higher = smoother fast scroll, more DOM
- Ensure the scroll container has a real height (`height` + `overflow-y: auto`).
