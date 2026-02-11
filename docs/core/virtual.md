# Virtual Lists

Dalila supports fixed-height list virtualization for very large collections.

Use this when rendering thousands of rows and you want a bounded DOM size.

## 1. Runtime Directive: `d-virtual-each`

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

### Required

- `d-virtual-each`: array or signal-of-array from context.
- `d-virtual-item-height`: fixed row height in pixels (number or numeric context value).

### Optional

- `d-virtual-overscan`: extra rows before/after viewport. Default: `6`.
- `d-virtual-height`: CSS height for the parent scroll container (`"400px"`, `"60vh"`, or context value).
- `d-key`: stable key field (recommended for reordering and updates).

### Notes

- V1 is vertical-only and fixed-height.
- The parent element is treated as the scroll container.
- If `d-virtual-item-height` is invalid, Dalila falls back to `d-each`.

## 2. Core Helper: `computeVirtualRange`

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

## 3. Performance Guidance

- Keep item templates lightweight.
- Prefer `d-key` with stable unique values.
- Tune `d-virtual-overscan`:
  - lower = less DOM, more mount/unmount
  - higher = smoother fast scroll, more DOM
- Ensure the scroll container has a real height (`height` + `overflow-y: auto`).
