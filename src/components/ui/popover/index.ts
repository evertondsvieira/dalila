import { signal } from "../../../core/signal.js";
import { getCurrentScope } from "../../../core/scope.js";
import type { Popover, PopoverOptions, PopoverPlacement } from "../ui-types.js";
import { validatePopoverOptions } from "../validate.js";
import { isBrowser } from "../env.js";

let popoverUid = 0;

function computePosition(
  trigger: HTMLElement,
  popoverEl: HTMLElement,
  placement: PopoverPlacement,
  gap: number,
  viewportPadding: number
): { top: number; left: number } {
  const triggerRect = trigger.getBoundingClientRect();
  const popRect = popoverEl.getBoundingClientRect();
  const vw = isBrowser ? window.innerWidth : 1024;
  const vh = isBrowser ? window.innerHeight : 768;

  // ── Flip when not enough space ──
  let effective = placement as string;

  if (effective.startsWith("bottom") && triggerRect.bottom + gap + popRect.height > vh - viewportPadding) {
    if (triggerRect.top - gap - popRect.height >= viewportPadding) {
      effective = effective.replace("bottom", "top");
    }
  } else if (effective.startsWith("top") && triggerRect.top - gap - popRect.height < viewportPadding) {
    if (triggerRect.bottom + gap + popRect.height <= vh - viewportPadding) {
      effective = effective.replace("top", "bottom");
    }
  } else if (effective === "left" && triggerRect.left - gap - popRect.width < viewportPadding) {
    if (triggerRect.right + gap + popRect.width <= vw - viewportPadding) {
      effective = "right";
    }
  } else if (effective === "right" && triggerRect.right + gap + popRect.width > vw - viewportPadding) {
    if (triggerRect.left - gap - popRect.width >= viewportPadding) {
      effective = "left";
    }
  }

  let top = 0;
  let left = 0;

  switch (effective) {
    case "bottom":
      top = triggerRect.bottom + gap;
      left = triggerRect.left + (triggerRect.width - popRect.width) / 2;
      break;
    case "bottom-start":
      top = triggerRect.bottom + gap;
      left = triggerRect.left;
      break;
    case "top":
      top = triggerRect.top - popRect.height - gap;
      left = triggerRect.left + (triggerRect.width - popRect.width) / 2;
      break;
    case "top-start":
      top = triggerRect.top - popRect.height - gap;
      left = triggerRect.left;
      break;
    case "left":
      top = triggerRect.top + (triggerRect.height - popRect.height) / 2;
      left = triggerRect.left - popRect.width - gap;
      break;
    case "right":
      top = triggerRect.top + (triggerRect.height - popRect.height) / 2;
      left = triggerRect.right + gap;
      break;
  }

  // Viewport clamping
  const maxLeft = vw - popRect.width - viewportPadding;
  left = Math.min(Math.max(viewportPadding, left), Math.max(viewportPadding, maxLeft));

  const maxTop = vh - popRect.height - viewportPadding;
  top = Math.min(Math.max(viewportPadding, top), Math.max(viewportPadding, maxTop));

  return { top, left };
}

export function createPopover(options: PopoverOptions = {}): Popover {
  validatePopoverOptions(options as Record<string, unknown>);
  const {
    placement: initialPlacement = "bottom",
    gap = 8,
    viewportPadding = 12,
  } = options;

  const open = signal(false);
  const placement = signal<PopoverPlacement>(initialPlacement);

  const show = () => open.set(true);
  const hide = () => open.set(false);
  const toggle = () => open.update((v) => !v);

  const position = (trigger: HTMLElement, popoverEl: HTMLElement) => {
    const { top, left } = computePosition(
      trigger,
      popoverEl,
      placement(),
      gap,
      viewportPadding
    );
    popoverEl.style.position = "fixed";
    popoverEl.style.top = `${top}px`;
    popoverEl.style.left = `${left}px`;
  };

  const _attachTo = (trigger: HTMLElement, popoverEl: HTMLElement) => {
    const scope = getCurrentScope();

    // Ensure popover attribute for native API
    if (!popoverEl.hasAttribute("popover")) {
      popoverEl.setAttribute("popover", "manual");
    }

    const reposition = () => {
      try {
        if (!popoverEl.matches(":popover-open")) return;
      } catch {
        return;
      }
      position(trigger, popoverEl);
    };

    // Sync open signal → native popover
    const unsub = open.on((isOpen) => {
      try {
        const isNativeOpen = popoverEl.matches(":popover-open");
        if (isOpen && !isNativeOpen) {
          popoverEl.showPopover();
          reposition();
        } else if (!isOpen && isNativeOpen) {
          popoverEl.hidePopover();
        }
      } catch {
        // Popover API not supported or element not connected
      }
    });

    // Sync native toggle → signal
    const onToggle = (ev: Event) => {
      const state = (ev as ToggleEvent).newState;
      if (state === "open") {
        if (!open.peek()) open.set(true);
        reposition();
      } else {
        if (open.peek()) open.set(false);
      }
    };
    popoverEl.addEventListener("toggle", onToggle);

    // Reposition on scroll/resize
    if (isBrowser) {
      window.addEventListener("resize", reposition);
      window.addEventListener("scroll", reposition, { passive: true });
    }

    // ARIA
    const popoverId = popoverEl.id || `d-popover-${++popoverUid}`;
    if (!popoverEl.id) popoverEl.id = popoverId;
    trigger.setAttribute("aria-controls", popoverId);
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-haspopup", "true");

    const unsubAria = open.on((isOpen) => {
      trigger.setAttribute("aria-expanded", String(isOpen));
    });

    if (scope) {
      scope.onCleanup(() => {
        unsub();
        unsubAria();
        popoverEl.removeEventListener("toggle", onToggle);
        if (isBrowser) {
          window.removeEventListener("resize", reposition);
          window.removeEventListener("scroll", reposition);
        }
      });
    }
  };

  return { open, show, hide, toggle, placement, position, _attachTo };
}
