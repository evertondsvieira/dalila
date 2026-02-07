import { computed, signal } from "../core/signal.js";
import { createScope, withScope } from "../core/scope.js";
import { bind } from "../runtime/bind.js";
import { tabBindings } from "./tabs.js";
import { isBrowser } from "./env.js";
// ── Constants ───────────────────────────────────────────────────────
const DEFAULT_EVENTS = [
    "click", "input", "change", "submit",
    "keydown", "keyup", "focus",
    "dragover", "dragleave", "drop",
];
const DEFAULT_TOAST_VARIANTS = ["success", "error", "warning", "info"];
// ── Tag Aliases ─────────────────────────────────────────────────────
const TAG_ALIASES = {
    "d-h1": "h1", "d-h2": "h2", "d-h3": "h3", "d-h4": "h4", "d-h5": "h5", "d-h6": "h6",
    "d-text": "p", "d-link": "a", "d-code-inline": "span", "d-kbd": "span",
    "d-field": "label", "d-field-label": "span", "d-field-hint": "span", "d-field-error": "span",
    "d-input": "input", "d-button-group": "div", "d-select": "select", "d-textarea": "textarea",
    "d-checkbox": "label", "d-radio-group": "div", "d-radio": "label",
    "d-slider": "input", "d-toggle": "label", "d-toggle-track": "span",
    "d-form": "form", "d-form-row": "div", "d-form-section-title": "h3", "d-form-actions": "div",
    "d-card": "div", "d-card-section": "div", "d-card-header": "div", "d-card-title": "h3",
    "d-card-description": "p", "d-card-body": "div", "d-card-footer": "div",
    "d-badge": "span", "d-chip": "span", "d-chip-remove": "button",
    "d-avatar": "div", "d-avatar-group": "div",
    "d-alert": "div", "d-alert-title": "strong", "d-alert-text": "p",
    "d-tooltip-trigger": "button",
    "d-accordion": "div", "d-accordion-item": "details", "d-accordion-body": "div",
    "d-collapsible": "details", "d-collapsible-body": "div",
    "d-table-wrapper": "div", "d-table": "table",
    "d-pagination": "nav", "d-page": "button", "d-page-ellipsis": "span",
    "d-breadcrumb": "ol", "d-breadcrumb-item": "li",
    "d-separator": "hr", "d-separator-label": "div",
    "d-skeleton": "div", "d-loading": "div", "d-spinner": "span",
    "d-empty": "div", "d-empty-icon": "div", "d-empty-title": "h3", "d-empty-text": "p",
    "d-stack": "div", "d-flex": "div", "d-grid": "div",
    "d-dialog": "dialog", "d-dialog-header": "div", "d-dialog-title": "h3",
    "d-dialog-body": "div", "d-dialog-footer": "div", "d-dialog-close": "button",
    "d-drawer": "dialog", "d-drawer-header": "div", "d-drawer-title": "h3",
    "d-drawer-body": "div", "d-drawer-footer": "div",
    "d-sheet": "dialog", "d-button": "button",
    "d-toast-container": "div", "d-toast": "div", "d-toast-icon": "div",
    "d-toast-body": "div", "d-toast-title": "div", "d-toast-text": "p", "d-toast-close": "button",
    "d-popover-trigger": "button",
    "d-dropdown": "div", "d-menu": "div", "d-menu-label": "div",
    "d-menu-item": "button", "d-menu-separator": "div",
    "d-combobox": "div", "d-combobox-input": "input", "d-combobox-trigger": "button",
    "d-combobox-list": "ul", "d-combobox-option": "li",
    "d-tabs": "div", "d-tab-list": "div", "d-tab": "button", "d-tab-panel": "div",
    "d-calendar": "div", "d-calendar-header": "div", "d-calendar-nav": "button",
    "d-calendar-title": "span", "d-calendar-grid": "div",
    "d-calendar-dow": "span", "d-calendar-day": "button",
    "d-dropzone": "div", "d-dropzone-icon": "div", "d-dropzone-text": "p", "d-dropzone-hint": "p",
    "d-popover": "div", "d-popover-title": "p", "d-popover-text": "p",
};
const TAG_DEFAULT_CLASS = {
    "d-h1": "d-h1", "d-h2": "d-h2", "d-h3": "d-h3", "d-h4": "d-h4", "d-h5": "d-h5", "d-h6": "d-h6",
    "d-text": "d-text", "d-link": "d-link", "d-code-inline": "d-code", "d-kbd": "d-kbd",
    "d-field": "d-field", "d-field-label": "d-field-label", "d-field-hint": "d-field-hint", "d-field-error": "d-field-error",
    "d-input": "d-input", "d-button-group": "d-btn-group", "d-select": "d-select", "d-textarea": "d-textarea",
    "d-checkbox": "d-checkbox", "d-radio-group": "d-radio-group", "d-radio": "d-radio",
    "d-slider": "d-slider", "d-toggle": "d-toggle", "d-toggle-track": "d-toggle-track",
    "d-form": "d-form", "d-form-row": "d-form-row", "d-form-section-title": "d-form-section-title", "d-form-actions": "d-form-actions",
    "d-card": "d-card", "d-card-section": "d-card-section", "d-card-header": "d-card-header", "d-card-title": "d-card-title",
    "d-card-description": "d-card-description", "d-card-body": "d-card-body", "d-card-footer": "d-card-footer",
    "d-badge": "d-badge", "d-chip": "d-chip", "d-chip-remove": "d-chip-remove",
    "d-avatar": "d-avatar", "d-avatar-group": "d-avatar-group",
    "d-alert": "d-alert", "d-alert-title": "d-alert-title", "d-alert-text": "d-alert-text",
    "d-tooltip-trigger": "d-btn d-tooltip",
    "d-accordion": "d-accordion", "d-accordion-item": "d-accordion-item", "d-accordion-body": "d-accordion-body",
    "d-collapsible": "d-collapsible", "d-collapsible-body": "d-collapsible-body",
    "d-table-wrapper": "d-table-wrapper", "d-table": "d-table",
    "d-pagination": "d-pagination", "d-page": "d-page", "d-page-ellipsis": "d-page-ellipsis",
    "d-breadcrumb": "d-breadcrumb", "d-breadcrumb-item": "d-breadcrumb-item",
    "d-separator": "d-separator", "d-separator-label": "d-separator-label",
    "d-skeleton": "d-skeleton", "d-loading": "d-loading", "d-spinner": "d-spinner",
    "d-empty": "d-empty", "d-empty-icon": "d-empty-icon", "d-empty-title": "d-empty-title", "d-empty-text": "d-empty-text",
    "d-stack": "d-stack", "d-flex": "d-flex", "d-grid": "d-grid",
    "d-button": "d-btn",
    "d-toast-container": "d-toast-container", "d-toast": "d-toast", "d-toast-icon": "d-toast-icon",
    "d-toast-body": "d-toast-body", "d-toast-title": "d-toast-title", "d-toast-text": "d-toast-text", "d-toast-close": "d-toast-close",
    "d-popover-trigger": "d-btn d-btn-primary",
    "d-dialog": "d-dialog", "d-dialog-header": "d-dialog-header", "d-dialog-title": "d-dialog-title",
    "d-dialog-body": "d-dialog-body", "d-dialog-footer": "d-dialog-footer", "d-dialog-close": "d-dialog-close",
    "d-drawer": "d-drawer", "d-sheet": "d-drawer d-sheet",
    "d-drawer-header": "d-drawer-header", "d-drawer-title": "d-drawer-title",
    "d-drawer-body": "d-drawer-body", "d-drawer-footer": "d-drawer-footer",
    "d-dropdown": "d-dropdown", "d-menu": "d-menu", "d-menu-label": "d-menu-label",
    "d-menu-item": "d-menu-item", "d-menu-separator": "d-menu-separator",
    "d-combobox": "d-combobox", "d-combobox-input": "d-input d-combobox-input",
    "d-combobox-trigger": "d-combobox-trigger", "d-combobox-list": "d-combobox-list", "d-combobox-option": "d-combobox-option",
    "d-tabs": "d-tabs", "d-tab-list": "d-tab-list", "d-tab": "d-tab", "d-tab-panel": "d-tab-panel",
    "d-calendar": "d-calendar", "d-calendar-header": "d-calendar-header", "d-calendar-nav": "d-calendar-nav",
    "d-calendar-title": "d-calendar-title", "d-calendar-grid": "d-calendar-grid", "d-calendar-dow": "d-calendar-dow", "d-calendar-day": "d-calendar-day",
    "d-dropzone": "d-dropzone", "d-dropzone-icon": "d-dropzone-icon", "d-dropzone-text": "d-dropzone-text", "d-dropzone-hint": "d-dropzone-hint",
    "d-popover": "d-popover", "d-popover-title": "d-popover-title", "d-popover-text": "d-popover-text",
};
const TAG_UPGRADE_RULES = {
    "d-button": { attrs: { variant: "d-btn-{}", size: "d-btn-{}" }, flags: { icon: "d-btn-icon" }, defaultType: "button" },
    "d-text": { attrs: { tone: "d-text-{}", size: "d-text-{}" } },
    "d-link": { attrs: { tone: "d-link-{}" } },
    "d-radio-group": { attrs: { variant: "d-radio-group-{}" } },
    "d-toggle": { attrs: { size: "d-toggle-{}" } },
    "d-form-actions": { attrs: { align: "d-form-actions-{}" } },
    "d-card": { attrs: { variant: "d-card-{}" } },
    "d-badge": { attrs: { variant: "d-badge-{}" }, flags: { dot: "d-badge-dot" } },
    "d-chip": { attrs: { variant: "d-chip-{}" } },
    "d-avatar": { attrs: { size: "d-avatar-{}", shape: "d-avatar-{}" } },
    "d-alert": { attrs: { variant: "d-alert-{}" } },
    "d-tooltip-trigger": { attrs: { place: "d-tooltip-{}" }, defaultType: "button" },
    "d-skeleton": { attrs: { kind: "d-skeleton-{}" } },
    "d-spinner": { attrs: { size: "d-spinner-{}" } },
    "d-stack": { attrs: { gap: "d-stack-{}" } },
    "d-flex": { flags: { wrap: "d-flex-wrap" } },
    "d-grid": { attrs: { cols: "d-grid-{}" } },
    "d-tab-list": { attrs: { variant: "d-tab-list-{}" } },
    "d-menu-item": { attrs: { variant: "d-menu-item-{}" }, defaultType: "button" },
    "d-chip-remove": { defaultType: "button" },
    "d-page": { defaultType: "button" },
    "d-toast-close": { defaultType: "button" },
    "d-popover-trigger": { defaultType: "button" },
    "d-dialog-close": { defaultType: "button" },
    "d-combobox-trigger": { defaultType: "button" },
    "d-tab": { defaultType: "button" },
    "d-calendar-nav": { defaultType: "button" },
    "d-calendar-day": { defaultType: "button" },
    "d-combobox-input": { defaultType: "text" },
};
// ── Tag upgrade engine ──────────────────────────────────────────────
function upgradeDalilaTags(root) {
    if (!isBrowser)
        return root;
    let currentRoot = root;
    for (const [sourceTag, targetTag] of Object.entries(TAG_ALIASES)) {
        const nodes = [];
        if (currentRoot.matches(sourceTag))
            nodes.push(currentRoot);
        nodes.push(...Array.from(currentRoot.querySelectorAll(sourceTag)));
        for (const node of nodes) {
            const replacement = currentRoot.ownerDocument.createElement(targetTag);
            for (const attr of Array.from(node.attributes)) {
                replacement.setAttribute(attr.name, attr.value);
            }
            replacement.setAttribute("data-d-tag", sourceTag);
            const defaultClass = TAG_DEFAULT_CLASS[sourceTag];
            if (defaultClass) {
                const current = replacement.getAttribute("class");
                replacement.setAttribute("class", current ? `${defaultClass} ${current}` : defaultClass);
            }
            const rule = TAG_UPGRADE_RULES[sourceTag];
            if (rule) {
                // Default type attribute
                if (rule.defaultType && !replacement.hasAttribute("type")) {
                    replacement.setAttribute("type", rule.defaultType);
                }
                // Attribute → class mappings
                if (rule.attrs) {
                    for (const [attr, template] of Object.entries(rule.attrs)) {
                        const val = replacement.getAttribute(attr);
                        if (val) {
                            replacement.classList.add(template.replace("{}", val));
                            replacement.removeAttribute(attr);
                        }
                    }
                }
                // Boolean flag → class mappings
                if (rule.flags) {
                    for (const [attr, className] of Object.entries(rule.flags)) {
                        if (replacement.hasAttribute(attr)) {
                            replacement.classList.add(className);
                            replacement.removeAttribute(attr);
                        }
                    }
                }
            }
            while (node.firstChild)
                replacement.appendChild(node.firstChild);
            node.replaceWith(replacement);
            if (node === currentRoot) {
                currentRoot = replacement;
            }
        }
    }
    return currentRoot;
}
// ── Element discovery ───────────────────────────────────────────────
function findByUI(root, name, fallbackTag) {
    // 0. Root itself
    if (root instanceof HTMLElement) {
        if (root.getAttribute("d-ui") === name)
            return root;
        if (fallbackTag && root.getAttribute("data-d-tag") === fallbackTag)
            return root;
    }
    // 1. d-ui attribute
    let el = root.querySelector(`[d-ui="${name}"]`);
    if (el)
        return el;
    // 2. ID match
    el = root.ownerDocument.getElementById(name);
    if (el && root.contains(el))
        return el;
    // 3. Fallback: first matching data-d-tag
    if (fallbackTag) {
        el = root.querySelector(`[data-d-tag="${fallbackTag}"]`);
        if (el)
            return el;
    }
    return null;
}
function findPopoverTrigger(root, id) {
    if (id)
        return root.ownerDocument.getElementById(id);
    return (root.querySelector(`[d-ui="popover-trigger"]`) ??
        root.querySelector(`[data-d-tag="d-popover-trigger"]`) ??
        null);
}
function findPopoverPanel(root, id) {
    if (id)
        return root.ownerDocument.getElementById(id);
    return (root.querySelector(`[d-ui="popover"]`) ??
        root.querySelector(`[data-d-tag="d-popover"]`) ??
        root.querySelector(`[popover]`) ??
        null);
}
// ── Context binding generators ──────────────────────────────────────
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
function addDialogBindings(ctx, key, dialog) {
    ctx[`${key}Show`] = dialog.show;
    ctx[`${key}Close`] = dialog.close;
    ctx[`${key}Open`] = dialog.open;
}
function addDropdownBindings(ctx, key, dd) {
    ctx[`${key}Class`] = computed(() => dd.open() ? "d-dropdown open" : "d-dropdown");
    ctx[`${key}Toggle`] = dd.toggle;
    ctx[`${key}Select`] = dd.select;
}
function addComboBindings(ctx, key, combo) {
    ctx[`${key}Class`] = computed(() => combo.open() ? "d-combobox open" : "d-combobox");
    ctx[`${key}Items`] = computed(() => {
        const items = combo.filtered();
        const hi = combo.highlightedIndex();
        const sel = combo.value();
        return items.map((opt, i) => ({
            value: opt.value,
            label: opt.label,
            optionClass: "d-combobox-option" + (opt.value === sel ? " selected" : "") + (i === hi ? " highlighted" : ""),
        }));
    });
    ctx[`${key}Label`] = combo.label;
    ctx[`${key}Input`] = combo.handleInput;
    ctx[`${key}Show`] = combo.show;
    ctx[`${key}Trigger`] = (ev) => {
        ev.stopPropagation();
        combo.toggle();
    };
    ctx[`${key}Select`] = combo.handleSelect;
    ctx[`${key}Keydown`] = combo.handleKeydown;
}
function addTabsBindings(ctx, key, mount) {
    ctx[`${key}Click`] = mount.api.handleClick;
    for (const [bindKey, tabId] of mount.bindings) {
        const b = tabBindings(mount.api, tabId);
        ctx[`${bindKey}Class`] = b.tabClass;
        ctx[`${bindKey}Visible`] = b.visible;
    }
}
function addToastBindings(ctx, key, toast) {
    let cycle = 0;
    ctx[`${key}ContainerClass`] = toast.containerClass;
    ctx[`${key}Items`] = toast.items;
    ctx[`show${capitalize(key)}`] = () => {
        const variant = DEFAULT_TOAST_VARIANTS[cycle++ % DEFAULT_TOAST_VARIANTS.length];
        toast.show(variant, variant.charAt(0).toUpperCase() + variant.slice(1), `This is a ${variant} toast notification.`);
    };
    ctx[`dismiss${capitalize(key)}`] = (ev) => {
        const target = ev.currentTarget;
        const id = target.dataset.id;
        if (id)
            toast.dismiss(id);
    };
}
function addCalendarBindings(ctx, key, cal) {
    ctx[`${key}Title`] = cal.title;
    ctx[`${key}Days`] = computed(() => cal.days().map((day) => ({
        date: day.date,
        dayClass: ["d-calendar-day", day.month !== "current" ? "other-month" : "", day.isToday ? "today" : "", day.isSelected ? "selected" : ""]
            .filter(Boolean)
            .join(" "),
        dateStr: day.fullDate.toISOString(),
        isDisabled: day.disabled || day.month !== "current",
    })));
    ctx[`${key}Prev`] = cal.prev;
    ctx[`${key}Next`] = cal.next;
    ctx[`${key}DayClick`] = cal.handleDayClick;
}
function addDropzoneBindings(ctx, key, dz) {
    ctx[`${key}Class`] = computed(() => dz.dragging() ? "d-dropzone dragover" : "d-dropzone");
    ctx[`${key}Click`] = dz.handleClick;
    ctx[`${key}Dragover`] = dz.handleDragover;
    ctx[`${key}Dragleave`] = dz.handleDragleave;
    ctx[`${key}Drop`] = dz.handleDrop;
}
// ── mountUI ─────────────────────────────────────────────────────────
export function mountUI(root, options) {
    if (!isBrowser)
        return () => { };
    const mountedRoot = upgradeDalilaTags(root);
    const sliderValue = options.sliderValue ?? signal("50");
    const ctx = { ...(options.context ?? {}) };
    const cleanups = [];
    const scope = createScope();
    // Theme toggle
    if (options.theme !== false) {
        ctx.onThemeToggle = (ev) => {
            const target = ev.target;
            mountedRoot.ownerDocument.documentElement.setAttribute("data-theme", target.checked ? "dark" : "");
        };
    }
    // Slider
    ctx.sliderValue = sliderValue;
    ctx.onSliderInput = (ev) => {
        const target = ev.target;
        sliderValue.set(target.value);
    };
    // ── Phase 1: Generate context bindings ──
    for (const [key, dialog] of Object.entries(options.dialogs ?? {})) {
        addDialogBindings(ctx, key, dialog);
    }
    for (const [key, drawer] of Object.entries(options.drawers ?? {})) {
        addDialogBindings(ctx, key, drawer);
    }
    for (const [key, dd] of Object.entries(options.dropdowns ?? {})) {
        addDropdownBindings(ctx, key, dd);
    }
    for (const [key, combo] of Object.entries(options.combos ?? {})) {
        addComboBindings(ctx, key, combo);
    }
    for (const [key, mount] of Object.entries(options.tabs ?? {})) {
        addTabsBindings(ctx, key, mount);
    }
    for (const [key, toast] of Object.entries(options.toasts ?? {})) {
        addToastBindings(ctx, key, toast);
    }
    for (const [key, cal] of Object.entries(options.calendars ?? {})) {
        addCalendarBindings(ctx, key, cal);
    }
    for (const [key, dz] of Object.entries(options.dropzones ?? {})) {
        addDropzoneBindings(ctx, key, dz);
    }
    // ── Phase 2: Bind + attach to DOM ──
    withScope(scope, () => {
        cleanups.push(bind(mountedRoot, ctx, {
            events: options.events ?? DEFAULT_EVENTS,
        }));
        // Attach dialogs
        for (const [key, dialog] of Object.entries(options.dialogs ?? {})) {
            const el = findByUI(mountedRoot, key, "d-dialog");
            if (el)
                dialog._attachTo(el);
        }
        // Attach drawers
        for (const [key, drawer] of Object.entries(options.drawers ?? {})) {
            const el = findByUI(mountedRoot, key, "d-drawer");
            if (el)
                drawer._attachTo(el);
        }
        // Attach dropdowns
        for (const [key, dd] of Object.entries(options.dropdowns ?? {})) {
            const el = findByUI(mountedRoot, key, "d-dropdown");
            if (el)
                dd._attachTo(el);
        }
        // Attach combos
        for (const [key, combo] of Object.entries(options.combos ?? {})) {
            const el = findByUI(mountedRoot, key, "d-combobox");
            if (el)
                combo._attachTo(el);
        }
        // Attach tabs
        for (const [key, mount] of Object.entries(options.tabs ?? {})) {
            const el = findByUI(mountedRoot, key, "d-tabs");
            if (el)
                mount.api._attachTo(el);
        }
        // Attach dropzones
        for (const [key, dz] of Object.entries(options.dropzones ?? {})) {
            const el = findByUI(mountedRoot, key, "d-dropzone");
            if (el)
                dz._attachTo(el);
        }
        // Attach accordions
        for (const [key, acc] of Object.entries(options.accordions ?? {})) {
            const el = findByUI(mountedRoot, key, "d-accordion");
            if (el)
                acc._attachTo(el);
        }
    });
    // Attach popovers (outside scope — manages its own listeners)
    for (const [key, mount] of Object.entries(options.popovers ?? {})) {
        const triggerEl = findPopoverTrigger(mountedRoot, mount.triggerId) ??
            findByUI(mountedRoot, `${key}-trigger`);
        const panelEl = findPopoverPanel(mountedRoot, mount.panelId) ??
            findByUI(mountedRoot, key, "d-popover");
        if (triggerEl && panelEl) {
            withScope(scope, () => {
                mount.api._attachTo(triggerEl, panelEl);
            });
        }
    }
    return () => {
        while (cleanups.length > 0) {
            const cleanup = cleanups.pop();
            if (cleanup)
                cleanup();
        }
        scope.dispose();
    };
}
