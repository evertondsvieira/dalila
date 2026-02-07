# Dalila UI

Interactive component library built on Dalila's signal-based reactivity. Every component uses native HTML elements, full ARIA accessibility, and scope-based cleanup.

## Quick Start

```ts
import {
  createDialog, createDrawer, createToast,
  createTabs, createDropdown, createCombobox,
  createAccordion, createCalendar, createDropzone,
  createPopover, mountUI,
} from "dalila/ui";
```

### Per-component imports (tree-shaking)

```ts
import { createDialog } from "dalila/ui/dialog";
import { createTabs }   from "dalila/ui/tabs";
```

Each component is also available at `dalila/ui/<name>` for minimal bundle size.

---

## CSS

### Full bundle

```html
<link rel="stylesheet" href="dalila/ui/dalila.css" />
```

Includes all 35+ component CSS files.

### Core only (minimal)

```html
<link rel="stylesheet" href="dalila/ui/dalila-core.css" />
```

Includes only: tokens, typography, layout, button, input, form.

### Per-component

```css
@import "dalila/ui/tokens.css";
@import "dalila/ui/button.css";
@import "dalila/ui/dialog.css";
```

The wildcard export `dalila/ui/*.css` makes every CSS file individually importable.

---

## Components

### Dialog

Native `<dialog>` modal with backdrop click and escape handling.

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `closeOnBackdrop` | `boolean` | `true` | Close when clicking backdrop |
| `closeOnEscape` | `boolean` | `true` | Close on Escape key |

**API:**
| Method/Signal | Description |
|---------------|-------------|
| `open` | `Signal<boolean>` — current open state |
| `show()` | Open the dialog |
| `close()` | Close the dialog |
| `toggle()` | Toggle open/close |
| `_attachTo(el)` | Attach to a `<dialog>` element |

**ARIA:** Sets `aria-modal="true"` automatically.

```html
<dialog id="my-dialog" class="d-dialog">
  <div class="d-dialog-header">
    <h3 class="d-dialog-title">Title</h3>
    <button class="d-dialog-close">&times;</button>
  </div>
  <div class="d-dialog-body">Content</div>
  <div class="d-dialog-footer">
    <button class="d-btn">Cancel</button>
    <button class="d-btn d-btn-primary">Confirm</button>
  </div>
</dialog>
```

---

### Drawer

Side panel / bottom sheet extending Dialog behavior.

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `closeOnBackdrop` | `boolean` | `true` | Close when clicking backdrop |
| `closeOnEscape` | `boolean` | `true` | Close on Escape key |
| `side` | `"right" \| "left" \| "bottom"` | `"right"` | Which side to open from |

**API:** Same as Dialog, plus `side: Signal<DrawerSide>`.

**CSS classes:** `d-drawer-left` (left), `d-sheet` (bottom).

---

### Popover

Floating positioned panel using the native Popover API.

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `placement` | `PopoverPlacement` | `"bottom"` | Position relative to trigger |
| `gap` | `number` | `8` | Gap between trigger and popover (px) |
| `viewportPadding` | `number` | `12` | Min distance from viewport edge (px) |

`PopoverPlacement`: `"top"` | `"bottom"` | `"left"` | `"right"` | `"top-start"` | `"bottom-start"`

**API:**
| Method/Signal | Description |
|---------------|-------------|
| `open` | `Signal<boolean>` |
| `placement` | `Signal<PopoverPlacement>` |
| `show()` / `hide()` / `toggle()` | Control visibility |
| `position(trigger, popoverEl)` | Recalculate position |
| `_attachTo(trigger, popoverEl)` | Attach to trigger + panel |

**Note:** Popover uses `_attachTo(trigger, panel)` with two arguments because it needs both the trigger element (for positioning/ARIA) and the panel element. This differs from single-element components like Dialog which use `_attachTo(el)`. This is an intentional design decision — not an inconsistency.

**ARIA:** Sets `aria-controls`, `aria-expanded`, `aria-haspopup` on trigger.

---

### Dropdown

Simple dropdown menu with outside-click dismissal.

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `closeOnSelect` | `boolean` | `true` | Close menu after selecting an item |

**API:**
| Method/Signal | Description |
|---------------|-------------|
| `open` | `Signal<boolean>` |
| `toggle(ev?)` | Toggle menu open/close |
| `close()` | Close menu |
| `select(ev?)` | Handle item selection |
| `_attachTo(el)` | Attach to wrapper element |

**ARIA:** Sets `aria-haspopup`, `aria-expanded` on trigger, `role="menu"` on menu.

---

### Combobox

Autocomplete select with filtering and keyboard navigation.

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `options` | `ComboboxOption[]` | *required* | Array of `{ value, label }` |
| `placeholder` | `string` | `""` | Input placeholder |
| `name` | `string` | `""` | Hidden input name for form submission |

**API:**
| Method/Signal | Description |
|---------------|-------------|
| `open` | `Signal<boolean>` |
| `query` | `Signal<string>` — current search text |
| `value` | `Signal<string>` — selected value |
| `label` | `Signal<string>` — selected label |
| `filtered` | `Signal<ComboboxOption[]>` — filtered options |
| `highlightedIndex` | `Signal<number>` |
| `show()` / `close()` / `toggle()` | Control list visibility |
| `handleInput(ev)` | Handle input events |
| `handleSelect(ev)` | Handle option click |
| `handleKeydown(ev)` | Handle keyboard navigation |
| `_attachTo(el)` | Attach to wrapper element |

**Form integration:** A hidden `<input type="hidden">` is automatically created inside the combobox wrapper. Its value syncs with the selected option, enabling native form submission.

**Keyboard:** ArrowDown/ArrowUp navigate, Enter selects, Escape closes.

**ARIA:** `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-activedescendant`, `role="listbox"`, `role="option"`.

---

### Accordion

Expandable section list using native `<details>`.

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `single` | `boolean` | `false` | Only one item open at a time |
| `initial` | `string[]` | `[]` | Initially open item IDs |

**API:**
| Method/Signal | Description |
|---------------|-------------|
| `openItems` | `Signal<Set<string>>` — set of open IDs |
| `toggle(id)` | Toggle an item open/closed |
| `open(id)` | Open a specific item |
| `close(id)` | Close a specific item |
| `isOpen(id)` | Returns `Signal<boolean>` (cached per ID) |
| `_attachTo(el)` | Attach to wrapper element |

```html
<div class="d-accordion">
  <details data-accordion="faq1" class="d-accordion-item">
    <summary>Question 1</summary>
    <div class="d-accordion-body">Answer 1</div>
  </details>
</div>
```

---

### Tabs

Tab navigation with automatic panel visibility and keyboard support.

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `initial` | `string` | `""` | Initially active tab ID |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | Tab list orientation |

**API:**
| Method/Signal | Description |
|---------------|-------------|
| `active` | `Signal<string>` — active tab ID |
| `select(id)` | Activate a tab |
| `isActive(id)` | Check if tab is active (boolean) |
| `handleClick(ev)` | Handle tab click via event delegation |
| `_attachTo(el)` | Attach to wrapper element |

**Keyboard navigation (on tab list):**
| Key | Action |
|-----|--------|
| ArrowRight (horizontal) / ArrowDown (vertical) | Next tab |
| ArrowLeft (horizontal) / ArrowUp (vertical) | Previous tab |
| Home | First tab |
| End | Last tab |

Wraps around at boundaries.

**Helper: `tabBindings(tabs, tabId)`**

Returns `{ tabClass, selected, visible }` signals for template binding.

**ARIA:** `role="tablist"` with `aria-orientation`, `role="tab"`, `aria-selected`, `tabindex`, `role="tabpanel"`, `aria-hidden`.

```html
<div class="d-tabs">
  <div class="d-tab-list">
    <button data-tab="tab1" class="d-tab">Tab 1</button>
    <button data-tab="tab2" class="d-tab">Tab 2</button>
  </div>
  <div class="d-tab-panel">Panel 1</div>
  <div class="d-tab-panel">Panel 2</div>
</div>
```

---

### Calendar

Date picker with month navigation and min/max constraints.

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `initial` | `Date` | `new Date()` | Initial display date |
| `min` | `Date` | — | Earliest selectable date |
| `max` | `Date` | — | Latest selectable date |
| `dayLabels` | `string[]` | `["Su","Mo"...]` | Day column headers |
| `monthLabels` | `string[]` | `["January"...]` | Month names |

**API:**
| Method/Signal | Description |
|---------------|-------------|
| `year` / `month` | `Signal<number>` |
| `selected` | `Signal<Date \| null>` |
| `title` | `Signal<string>` — e.g. "June 2024" |
| `days` | `Signal<CalendarDay[]>` — 42-day grid |
| `dayLabels` | `string[]` |
| `prev()` / `next()` | Navigate months |
| `select(date)` | Select a date |
| `handleDayClick(ev)` | Handle day button click |

---

### Toast

Notification system with auto-dismiss and variant styling.

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `position` | `ToastPosition` | `"top-right"` | Container position |
| `duration` | `number` | `4000` | Auto-dismiss time (ms) |
| `maxToasts` | `number` | `5` | Max visible toasts |

**API:**
| Method/Signal | Description |
|---------------|-------------|
| `items` | `Signal<ToastItem[]>` |
| `activeVariant` | `Signal<ToastVariant \| "idle">` |
| `containerClass` | `Signal<string>` |
| `show(variant, title, text?, duration?)` | Show toast, returns ID |
| `success(title, text?)` | Shorthand |
| `error(title, text?)` | Shorthand |
| `warning(title, text?)` | Shorthand |
| `info(title, text?)` | Shorthand |
| `dismiss(id)` | Remove specific toast |
| `clear()` | Remove all toasts |

**Helper: `toastIcon(variant)`** — Returns reactive icon `DocumentFragment`.

---

### Dropzone

File upload area with drag-and-drop support.

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `accept` | `string` | — | MIME types or extensions (e.g. `"image/*,.pdf"`) |
| `multiple` | `boolean` | `true` | Allow multiple files |
| `maxFiles` | `number` | — | Maximum number of files |
| `maxSize` | `number` | — | Maximum file size in bytes |

**API:**
| Method/Signal | Description |
|---------------|-------------|
| `dragging` | `Signal<boolean>` |
| `files` | `Signal<File[]>` |
| `browse()` | Open file picker |
| `handleClick()` / `handleDragover(ev)` / `handleDragleave()` / `handleDrop(ev)` | Event handlers |
| `_attachTo(el)` | Attach to wrapper element |

**ARIA:** Sets `role="button"`, `tabindex="0"`.

---

## Custom HTML Tags

Dalila UI provides custom `<d-*>` tags that are upgraded to standard HTML at mount time via `mountUI()` or `upgradeDalilaTags()`:

```html
<d-button variant="primary" size="sm">Click me</d-button>
<!-- Becomes: <button class="d-btn d-btn-primary d-btn-sm" type="button">Click me</button> -->
```

Common tags:
- `<d-button>`, `<d-input>`, `<d-select>`, `<d-textarea>`
- `<d-card>`, `<d-badge>`, `<d-chip>`, `<d-avatar>`, `<d-alert>`
- `<d-dialog>`, `<d-drawer>`, `<d-sheet>`
- `<d-tabs>`, `<d-tab-list>`, `<d-tab>`, `<d-tab-panel>`
- `<d-dropdown>`, `<d-menu>`, `<d-menu-item>`
- `<d-combobox>`, `<d-combobox-input>`, `<d-combobox-list>`
- `<d-accordion>`, `<d-accordion-item>`
- `<d-calendar>`, `<d-toast-container>`, `<d-dropzone>`, `<d-popover>`
- `<d-form>`, `<d-field>`, `<d-checkbox>`, `<d-radio>`, `<d-toggle>`

Attributes like `variant`, `size`, `tone` are converted to CSS classes.

---

## `mountUI(root, options)`

Orchestrates tag upgrade, context binding, and component attachment in one call.

```ts
const cleanup = mountUI(document.body, {
  dialogs:    { myDialog: createDialog() },
  drawers:    { sidebar: createDrawer({ side: 'left' }) },
  dropdowns:  { menu: createDropdown() },
  combos:     { search: createCombobox({ options: [...] }) },
  tabs:       { nav: { api: createTabs({ initial: 'home' }), bindings: [...] } },
  toasts:     { notif: createToast() },
  popovers:   { info: { api: createPopover() } },
  dropzones:  { upload: createDropzone() },
  calendars:  { picker: createCalendar() },
  accordions: { faq: createAccordion() },
});

// Later:
cleanup();
```

Components are found by `d-ui` attribute, ID, or fallback `data-d-tag`.

---

## Lifecycle Hook: `onMount`

When using Dalila Router with UI components, export an `onMount` function from your route to initialize components after the view is mounted to the DOM.

**Why `onMount`?**

The router needs to render the HTML first before UI components can attach to DOM elements. The `onMount` hook is called automatically after the view is mounted, giving you a safe place to call `mountUI()`.

**Example:**

```ts
// src/app/page.ts
import { signal } from 'dalila';
import { createDialog, mountUI } from 'dalila/components/ui';

// Create components at module scope (shared across lifecycle)
const confirmDialog = createDialog({
  closeOnBackdrop: true,
  closeOnEscape: true
});

export function loader() {
  const count = signal(0);

  return {
    count,
    increment: () => count.update(n => n + 1),
    openDialog: () => confirmDialog.show(),
    closeDialog: () => confirmDialog.close(),
  };
}

// Called after the view is mounted to the DOM
export function onMount(root: HTMLElement) {
  mountUI(root, {
    dialogs: { confirmDialog }
  });
}
```

```html
<!-- src/app/page.html -->
<div>
  <p>Count: {count}</p>
  <button d-on-click="increment">+</button>
  <button d-on-click="openDialog">Open Dialog</button>
</div>

<d-dialog d-ui="confirmDialog">
  <d-dialog-header>
    <d-dialog-title>Confirm Action</d-dialog-title>
    <d-dialog-close d-on-click="closeDialog">&times;</d-dialog-close>
  </d-dialog-header>
  <d-dialog-body>
    <p>Current count: {count}</p>
  </d-dialog-body>
  <d-dialog-footer>
    <d-button variant="ghost" d-on-click="closeDialog">Cancel</d-button>
    <d-button variant="primary" d-on-click="closeDialog">OK</d-button>
  </d-dialog-footer>
</d-dialog>
```

**Key points:**

- `onMount(root)` receives the root element where your view was mounted
- Create components outside `loader()` so they persist across calls
- The `d-ui` attribute connects HTML elements to component instances
- Works with both eager and lazy-loaded routes

---

## Prop Validation

All `create*` functions validate options at creation time:

```ts
createDialog({ closeOnBackdrop: "yes" });
// ⚠️ [Dalila] createDialog: "closeOnBackdrop" expected boolean, got string (yes)

createToast({ duration: -1 });
// ⚠️ [Dalila] createToast: "duration" must be a number > 0, got -1
```

Validation uses `console.warn` — it never throws, so it won't break production apps.

---

## SSR Compatibility

Dalila UI is SSR-safe. All browser API access (`window`, `document`) is guarded:

```ts
import { isBrowser } from "dalila/ui/env";
// true in browsers, false in Node/Deno/Bun
```

- `mountUI()` returns a no-op cleanup if called on the server
- `upgradeDalilaTags()` is skipped on the server
- Event listeners on `window`/`document` are only registered in browser
- Components can be created on the server (signals work everywhere) but `_attachTo()` should only be called in the browser

---

## API Design: `_attachTo` signatures

Most components use `_attachTo(el)` with a single wrapper element. Popover is the exception:

```ts
dialog._attachTo(dialogEl);           // single element
popover._attachTo(triggerEl, panelEl); // two elements
```

This difference is intentional. Dialog, Drawer, Dropdown, etc. are self-contained in a single DOM element. Popover needs both a trigger (the button that opens it) and a panel (the floating content) — which are often in different parts of the DOM tree (the panel may be in the top layer).

---

## Design Tokens

All visual values are CSS custom properties defined in `tokens.css`:

- **Colors:** `--d-primary-*`, `--d-accent-*`, `--d-slate-*`, `--d-success`, `--d-error`, `--d-warning`, `--d-info`
- **Typography:** `--d-font-sans`, `--d-font-mono`, `--d-text-xs` to `--d-text-3xl`
- **Spacing:** `--d-space-1` (0.25rem) to `--d-space-12` (3rem)
- **Radii:** `--d-radius-sm`, `--d-radius-md`, `--d-radius-lg`
- **Shadows:** `--d-shadow-md`, `--d-shadow-lg`, `--d-shadow-glow`
- **Z-index:** `--d-z-dropdown`, `--d-z-toast`, `--d-z-sticky`

Dark mode: all tokens are redefined under `[data-theme="dark"]`.
