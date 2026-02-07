import { signal, computed } from "../../../core/signal.js";
import { getCurrentScope } from "../../../core/scope.js";
import { validateComboboxOptions } from "../validate.js";
import { isBrowser } from "../env.js";
let comboboxUid = 0;
export function createCombobox(options) {
    validateComboboxOptions(options);
    const { options: items, placeholder = "", name: fieldName } = options;
    const open = signal(false);
    const query = signal("");
    const value = signal("");
    const label = signal("");
    const highlightedIndex = signal(-1);
    const filtered = computed(() => {
        const q = query().toLowerCase();
        if (!q)
            return items;
        return items.filter((opt) => opt.label.toLowerCase().includes(q));
    });
    const show = () => open.set(true);
    const close = () => {
        open.set(false);
        highlightedIndex.set(-1);
    };
    const toggle = () => open.update((v) => !v);
    const handleInput = (ev) => {
        const input = ev.target;
        query.set(input.value);
        open.set(true);
        highlightedIndex.set(-1);
    };
    const handleSelect = (ev) => {
        const target = ev.target.closest("[data-value]");
        if (!target)
            return;
        const val = target.dataset.value ?? "";
        const lbl = target.textContent?.trim() ?? val;
        value.set(val);
        label.set(lbl);
        query.set(lbl);
        close();
    };
    const handleKeydown = (ev) => {
        const list = filtered();
        switch (ev.key) {
            case "ArrowDown":
                ev.preventDefault();
                if (!open()) {
                    show();
                }
                else {
                    highlightedIndex.update((i) => i < list.length - 1 ? i + 1 : 0);
                }
                break;
            case "ArrowUp":
                ev.preventDefault();
                if (open()) {
                    highlightedIndex.update((i) => i > 0 ? i - 1 : list.length - 1);
                }
                break;
            case "Enter":
                ev.preventDefault();
                if (open() && highlightedIndex() >= 0) {
                    const opt = list[highlightedIndex()];
                    if (opt) {
                        value.set(opt.value);
                        label.set(opt.label);
                        query.set(opt.label);
                        close();
                    }
                }
                break;
            case "Escape":
                close();
                break;
        }
    };
    const _attachTo = (el) => {
        const scope = getCurrentScope();
        const uid = ++comboboxUid;
        // ARIA setup
        const input = el.querySelector("input");
        const list = el.querySelector("ul, [data-d-tag='d-combobox-list'], .d-combobox-list");
        if (input) {
            if (placeholder)
                input.setAttribute("placeholder", placeholder);
            input.setAttribute("role", "combobox");
            input.setAttribute("aria-autocomplete", "list");
            input.setAttribute("aria-expanded", "false");
        }
        if (list) {
            const listId = list.id || `d-combobox-list-${uid}`;
            if (!list.id)
                list.id = listId;
            list.setAttribute("role", "listbox");
            if (input)
                input.setAttribute("aria-controls", listId);
        }
        const unsubExpanded = open.on((isOpen) => {
            input?.setAttribute("aria-expanded", String(isOpen));
        });
        const unsubHighlight = highlightedIndex.on((idx) => {
            if (idx >= 0 && list) {
                const opts = list.querySelectorAll("[data-value]");
                const active = opts[idx];
                if (active) {
                    const activeId = active.id || `d-combobox-opt-${uid}-${idx}`;
                    if (!active.id)
                        active.id = activeId;
                    active.setAttribute("role", "option");
                    input?.setAttribute("aria-activedescendant", activeId);
                }
            }
            else {
                input?.removeAttribute("aria-activedescendant");
            }
        });
        // Hidden input for form submission
        let hidden = el.querySelector('input[type="hidden"]');
        if (!hidden) {
            hidden = el.ownerDocument.createElement("input");
            hidden.type = "hidden";
            hidden.name = fieldName || input?.getAttribute("name") || "";
            el.appendChild(hidden);
        }
        const unsubValue = value.on((v) => {
            if (hidden)
                hidden.value = v;
        });
        const onDocClick = (e) => {
            if (!el.contains(e.target))
                close();
        };
        if (isBrowser)
            document.addEventListener("click", onDocClick);
        if (scope) {
            scope.onCleanup(() => {
                unsubExpanded();
                unsubHighlight();
                unsubValue();
                if (isBrowser)
                    document.removeEventListener("click", onDocClick);
            });
        }
    };
    return {
        open,
        query,
        value,
        label,
        filtered,
        highlightedIndex,
        show,
        close,
        toggle,
        handleInput,
        handleSelect,
        handleKeydown,
        _attachTo,
    };
}
