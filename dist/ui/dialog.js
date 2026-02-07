import { signal } from "../core/signal.js";
import { getCurrentScope } from "../core/scope.js";
import { validateDialogOptions } from "./validate.js";
/**
 * Shared dialog behavior — used by both createDialog and createDrawer.
 */
export function _attachDialogBehavior(el, open, closeFn, opts) {
    const scope = getCurrentScope();
    // Sync signal → native dialog
    const unsub = open.on((isOpen) => {
        if (isOpen && !el.open)
            el.showModal();
        else if (!isOpen && el.open)
            el.close();
    });
    // Native close event → sync signal
    const onClose = () => open.set(false);
    el.addEventListener("close", onClose);
    // Backdrop click
    const onBackdropClick = (e) => {
        if (opts.closeOnBackdrop && e.target === el)
            closeFn();
    };
    el.addEventListener("click", onBackdropClick);
    // Escape key
    if (!opts.closeOnEscape) {
        const onCancel = (e) => e.preventDefault();
        el.addEventListener("cancel", onCancel);
        if (scope) {
            scope.onCleanup(() => el.removeEventListener("cancel", onCancel));
        }
    }
    // ARIA
    el.setAttribute("aria-modal", "true");
    if (scope) {
        scope.onCleanup(() => {
            unsub();
            el.removeEventListener("close", onClose);
            el.removeEventListener("click", onBackdropClick);
        });
    }
}
export function createDialog(options = {}) {
    validateDialogOptions(options);
    const { closeOnBackdrop = true, closeOnEscape = true } = options;
    const open = signal(false);
    const show = () => open.set(true);
    const close = () => open.set(false);
    const toggle = () => open.update((v) => !v);
    const _attachTo = (el) => {
        _attachDialogBehavior(el, open, close, { closeOnBackdrop, closeOnEscape });
    };
    return { open, show, close, toggle, _attachTo };
}
