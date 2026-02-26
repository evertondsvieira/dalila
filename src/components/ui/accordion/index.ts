import { signal, computed, type ReadonlySignal, type Signal } from "../../../core/signal.js";
import { getCurrentScope } from "../../../core/scope.js";
import type { Accordion, AccordionOptions } from "../ui-types.js";

export function createAccordion(options: AccordionOptions = {}): Accordion {
  const { single = false, initial = [] } = options;
  const hasInitial = Object.prototype.hasOwnProperty.call(options, "initial");
  const seededInitial = single ? initial.slice(0, 1) : initial;
  const openItems = signal(new Set<string>(seededInitial));

  const toggle = (itemId: string) => {
    openItems.update((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        if (single) next.clear();
        next.add(itemId);
      }
      return next;
    });
  };

  const open = (itemId: string) => {
    openItems.update((current) => {
      const next = new Set(current);
      if (single) next.clear();
      next.add(itemId);
      return next;
    });
  };

  const close = (itemId: string) => {
    openItems.update((current) => {
      const next = new Set(current);
      next.delete(itemId);
      return next;
    });
  };

  const _isOpenCache = new Map<string, ReadonlySignal<boolean>>();

  const isOpen = (itemId: string): ReadonlySignal<boolean> => {
    let sig = _isOpenCache.get(itemId);
    if (!sig) {
      sig = computed(() => openItems().has(itemId));
      _isOpenCache.set(itemId, sig);
    }
    return sig;
  };

  const _attachTo = (el: HTMLElement) => {
    const scope = getCurrentScope();
    let syncing = false;

    const allDetails = () =>
      Array.from(el.querySelectorAll<HTMLDetailsElement>("details[data-accordion]"));

    const syncDOMFromSignal = (set: Set<string>) => {
      syncing = true;
      for (const details of allDetails()) {
        const itemId = details.dataset.accordion;
        if (!itemId) continue;
        details.open = set.has(itemId);
      }
      syncing = false;
    };

    const syncSignalFromDOM = () => {
      const next = new Set<string>();
      for (const details of allDetails()) {
        if (!details.open) continue;
        const itemId = details.dataset.accordion;
        if (!itemId) continue;
        if (single) {
          next.clear();
        }
        next.add(itemId);
      }
      openItems.set(next);
    };

    const onToggle = (ev: Event) => {
      const details = ev.target as HTMLDetailsElement;
      if (syncing) return;

      const itemId = details.dataset.accordion;
      if (!itemId) return;

      openItems.update((current) => {
        const next = new Set(current);
        if (details.open) {
          if (single) next.clear();
          next.add(itemId);
        } else {
          next.delete(itemId);
        }
        return next;
      });
    };

    const unsub = openItems.on((set) => {
      if (!syncing) syncDOMFromSignal(set);
    });

    // If initial was not provided, respect current DOM open state.
    if (!hasInitial) syncSignalFromDOM();
    else syncDOMFromSignal(openItems());

    el.addEventListener("toggle", onToggle, true);

    if (scope) {
      scope.onCleanup(() => {
        unsub();
        el.removeEventListener("toggle", onToggle, true);
      });
    }
  };

  return { openItems, toggle, open, close, isOpen, _attachTo };
}
