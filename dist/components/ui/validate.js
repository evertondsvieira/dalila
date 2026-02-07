// ── Prop Validation ─────────────────────────────────────────────────
const VALID_TOAST_POSITIONS = new Set([
    "top-right", "top-left", "bottom-right", "bottom-left", "top-center", "bottom-center",
]);
const VALID_POPOVER_PLACEMENTS = new Set([
    "top", "bottom", "left", "right", "top-start", "bottom-start",
]);
const VALID_DRAWER_SIDES = new Set(["right", "left", "bottom"]);
function warn(component, message) {
    console.warn(`[Dalila] ${component}: ${message}`);
}
function warnInvalidType(component, prop, expected, got) {
    warn(component, `"${prop}" expected ${expected}, got ${typeof got} (${String(got)})`);
}
export function validateDialogOptions(opts) {
    if (opts.closeOnBackdrop !== undefined && typeof opts.closeOnBackdrop !== "boolean") {
        warnInvalidType("createDialog", "closeOnBackdrop", "boolean", opts.closeOnBackdrop);
    }
    if (opts.closeOnEscape !== undefined && typeof opts.closeOnEscape !== "boolean") {
        warnInvalidType("createDialog", "closeOnEscape", "boolean", opts.closeOnEscape);
    }
}
export function validateDrawerOptions(opts) {
    validateDialogOptions(opts);
    if (opts.side !== undefined && !VALID_DRAWER_SIDES.has(opts.side)) {
        warn("createDrawer", `"side" must be one of "right"|"left"|"bottom", got "${String(opts.side)}"`);
    }
}
export function validateToastOptions(opts) {
    if (opts.position !== undefined && !VALID_TOAST_POSITIONS.has(opts.position)) {
        warn("createToast", `"position" must be a valid ToastPosition, got "${String(opts.position)}"`);
    }
    if (opts.duration !== undefined && (typeof opts.duration !== "number" || opts.duration < 0)) {
        warn("createToast", `"duration" must be a number >= 0, got ${String(opts.duration)}`);
    }
    if (opts.maxToasts !== undefined && (typeof opts.maxToasts !== "number" || opts.maxToasts <= 0)) {
        warn("createToast", `"maxToasts" must be a number > 0, got ${String(opts.maxToasts)}`);
    }
}
export function validatePopoverOptions(opts) {
    if (opts.placement !== undefined && !VALID_POPOVER_PLACEMENTS.has(opts.placement)) {
        warn("createPopover", `"placement" must be a valid PopoverPlacement, got "${String(opts.placement)}"`);
    }
    if (opts.gap !== undefined && (typeof opts.gap !== "number" || opts.gap < 0)) {
        warn("createPopover", `"gap" must be a number >= 0, got ${String(opts.gap)}`);
    }
    if (opts.viewportPadding !== undefined && (typeof opts.viewportPadding !== "number" || opts.viewportPadding < 0)) {
        warn("createPopover", `"viewportPadding" must be a number >= 0, got ${String(opts.viewportPadding)}`);
    }
}
export function validateDropzoneOptions(opts) {
    if (opts.maxFiles !== undefined && (typeof opts.maxFiles !== "number" || opts.maxFiles <= 0)) {
        warn("createDropzone", `"maxFiles" must be a number > 0, got ${String(opts.maxFiles)}`);
    }
    if (opts.maxSize !== undefined && (typeof opts.maxSize !== "number" || opts.maxSize <= 0)) {
        warn("createDropzone", `"maxSize" must be a number > 0, got ${String(opts.maxSize)}`);
    }
}
export function validateCalendarOptions(opts) {
    const min = opts.min;
    const max = opts.max;
    if (min && max && min > max) {
        warn("createCalendar", `"min" must be before "max"`);
    }
}
export function validateComboboxOptions(opts) {
    const options = opts.options;
    if (!Array.isArray(options) || options.length === 0) {
        warn("createCombobox", `"options" must be a non-empty array`);
    }
}
