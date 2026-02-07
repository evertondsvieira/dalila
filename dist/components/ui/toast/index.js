import { signal } from "../../../core/signal.js";
import { getCurrentScope } from "../../../core/scope.js";
import { match } from "../../../core/match.js";
import { html } from "../../../core/html.js";
import { validateToastOptions } from "../validate.js";
import { isBrowser } from "../env.js";
const VARIANT_CLASSES = {
    success: "d-toast d-toast-success",
    error: "d-toast d-toast-error",
    warning: "d-toast d-toast-warning",
    info: "d-toast d-toast-info",
};
const VARIANT_ICONS = {
    success: "\u2705",
    error: "\u274C",
    warning: "\u26A0\uFE0F",
    info: "\u2139\uFE0F",
};
const POSITION_CLASSES = {
    "top-right": "d-toast-container d-toast-top-right",
    "top-left": "d-toast-container d-toast-top-left",
    "bottom-right": "d-toast-container d-toast-bottom-right",
    "bottom-left": "d-toast-container d-toast-bottom-left",
    "top-center": "d-toast-container d-toast-top-center",
    "bottom-center": "d-toast-container d-toast-bottom-center",
};
let toastUid = 0;
export function createToast(options = {}) {
    validateToastOptions(options);
    const { position = "top-right", duration: defaultDuration = 4000, maxToasts = 5, } = options;
    const items = signal([]);
    const activeVariant = signal("idle");
    const containerClass = signal(POSITION_CLASSES[position] ?? POSITION_CLASSES["top-right"]);
    const scope = getCurrentScope();
    const timers = new Map();
    const dismiss = (id) => {
        const timer = timers.get(id);
        if (timer) {
            clearTimeout(timer);
            timers.delete(id);
        }
        items.update((list) => list.filter((t) => t.id !== id));
        if (items().length === 0)
            activeVariant.set("idle");
    };
    const clear = () => {
        timers.forEach((t) => clearTimeout(t));
        timers.clear();
        items.set([]);
        activeVariant.set("idle");
    };
    const show = (variant, title, text, duration) => {
        const id = `toast-${++toastUid}`;
        const item = {
            id,
            variant,
            title,
            text,
            variantClass: VARIANT_CLASSES[variant],
            icon: VARIANT_ICONS[variant],
        };
        items.update((list) => {
            const next = [...list, item];
            // Enforce max toasts — remove oldest
            while (next.length > maxToasts) {
                const oldest = next.shift();
                const timer = timers.get(oldest.id);
                if (timer) {
                    clearTimeout(timer);
                    timers.delete(oldest.id);
                }
            }
            return next;
        });
        activeVariant.set(variant);
        const ms = duration ?? defaultDuration;
        if (ms > 0) {
            const timer = setTimeout(() => dismiss(id), ms);
            timers.set(id, timer);
        }
        return id;
    };
    const success = (title, text) => show("success", title, text);
    const error = (title, text) => show("error", title, text);
    const warning = (title, text) => show("warning", title, text);
    const info = (title, text) => show("info", title, text);
    if (scope) {
        scope.onCleanup(() => {
            timers.forEach((t) => clearTimeout(t));
            timers.clear();
        });
    }
    return {
        items,
        activeVariant,
        containerClass,
        show,
        success,
        error,
        warning,
        info,
        dismiss,
        clear,
    };
}
export function toastIcon(variant) {
    return match(variant, {
        success: () => html `<span class="d-toast-icon">\u2705</span>`,
        error: () => html `<span class="d-toast-icon">\u274C</span>`,
        warning: () => html `<span class="d-toast-icon">\u26A0\uFE0F</span>`,
        info: () => html `<span class="d-toast-icon">\u2139\uFE0F</span>`,
        idle: () => isBrowser ? document.createComment("no toast") : null,
        _: () => isBrowser ? document.createComment("no toast") : null,
    });
}
