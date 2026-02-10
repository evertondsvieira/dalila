import { signal } from "../../../core/signal.js";
import type { Dialog, DialogOptions } from "../ui-types.js";
import { validateDialogOptions } from "../validate.js";
import { attachDialogBehavior } from "./internal.js";

export function createDialog(options: DialogOptions = {}): Dialog {
  validateDialogOptions(options as Record<string, unknown>);
  const { closeOnBackdrop = true, closeOnEscape = true } = options;
  const open = signal(false);

  const show = () => open.set(true);
  const close = () => open.set(false);
  const toggle = () => open.update((v) => !v);

  const _attachTo = (el: HTMLDialogElement) => {
    attachDialogBehavior(el, open, close, { closeOnBackdrop, closeOnEscape });
  };

  return { open, show, close, toggle, _attachTo };
}
