import { signal } from "../core/signal.js";
import { getCurrentScope } from "../core/scope.js";
import { _attachDialogBehavior } from "./dialog.js";
import { validateDrawerOptions } from "./validate.js";
const SIDE_CLASSES = {
    right: "",
    left: "d-drawer-left",
    bottom: "d-sheet",
};
export function createDrawer(options = {}) {
    validateDrawerOptions(options);
    const { closeOnBackdrop = true, closeOnEscape = true, side: initialSide = "right", } = options;
    const open = signal(false);
    const side = signal(initialSide);
    const show = () => open.set(true);
    const close = () => open.set(false);
    const toggle = () => open.update((v) => !v);
    const _attachTo = (el) => {
        const scope = getCurrentScope();
        // Shared dialog behavior (open sync, backdrop, escape, ARIA)
        _attachDialogBehavior(el, open, close, { closeOnBackdrop, closeOnEscape });
        // Apply initial side class
        const initial = SIDE_CLASSES[side()];
        if (initial)
            el.classList.add(initial);
        // React to side changes
        const unsub = side.on((s) => {
            for (const cls of Object.values(SIDE_CLASSES)) {
                if (cls)
                    el.classList.remove(cls);
            }
            const cls = SIDE_CLASSES[s];
            if (cls)
                el.classList.add(cls);
        });
        if (scope) {
            scope.onCleanup(() => unsub());
        }
    };
    return { open, side, show, close, toggle, _attachTo };
}
