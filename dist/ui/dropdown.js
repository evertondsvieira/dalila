import { signal } from "../core/signal.js";
import { getCurrentScope } from "../core/scope.js";
import { isBrowser } from "./env.js";
export function createDropdown(options = {}) {
    const { closeOnSelect = true } = options;
    const open = signal(false);
    const toggle = (ev) => {
        if (ev)
            ev.stopPropagation();
        open.update((v) => !v);
    };
    const close = () => open.set(false);
    const select = (ev) => {
        if (ev)
            ev.stopPropagation();
        if (closeOnSelect)
            close();
    };
    const _attachTo = (el) => {
        const scope = getCurrentScope();
        // ARIA
        const trigger = el.querySelector("button, [role='button'], [data-d-tag='d-button']");
        const menu = el.querySelector("[data-d-tag='d-menu'], .d-menu");
        if (menu)
            menu.setAttribute("role", "menu");
        if (trigger) {
            trigger.setAttribute("aria-haspopup", "true");
            trigger.setAttribute("aria-expanded", "false");
        }
        const unsubAria = open.on((isOpen) => {
            trigger?.setAttribute("aria-expanded", String(isOpen));
        });
        const onDocClick = (e) => {
            if (!el.contains(e.target))
                close();
        };
        if (isBrowser)
            document.addEventListener("click", onDocClick);
        if (scope) {
            scope.onCleanup(() => {
                unsubAria();
                if (isBrowser)
                    document.removeEventListener("click", onDocClick);
            });
        }
    };
    return { open, toggle, close, select, _attachTo };
}
