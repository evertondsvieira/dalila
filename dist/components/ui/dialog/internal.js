import { getCurrentScope } from "../../../core/scope.js";
export function attachDialogBehavior(el, open, closeFn, opts) {
    const scope = getCurrentScope();
    const unsub = open.on((isOpen) => {
        if (isOpen && !el.open)
            el.showModal();
        else if (!isOpen && el.open)
            el.close();
    });
    const onClose = () => open.set(false);
    el.addEventListener("close", onClose);
    const onBackdropClick = (e) => {
        if (opts.closeOnBackdrop && e.target === el)
            closeFn();
    };
    el.addEventListener("click", onBackdropClick);
    if (!opts.closeOnEscape) {
        const onCancel = (e) => e.preventDefault();
        el.addEventListener("cancel", onCancel);
        if (scope) {
            scope.onCleanup(() => el.removeEventListener("cancel", onCancel));
        }
    }
    el.setAttribute("aria-modal", "true");
    if (scope) {
        scope.onCleanup(() => {
            unsub();
            el.removeEventListener("close", onClose);
            el.removeEventListener("click", onBackdropClick);
        });
    }
}
