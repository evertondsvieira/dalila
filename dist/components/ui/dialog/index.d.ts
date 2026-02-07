import { type Signal } from "../../../core/signal.js";
import type { Dialog, DialogOptions } from "../ui-types.js";
/**
 * Shared dialog behavior — used by both createDialog and createDrawer.
 */
export declare function _attachDialogBehavior(el: HTMLDialogElement, open: Signal<boolean>, closeFn: () => void, opts: {
    closeOnBackdrop: boolean;
    closeOnEscape: boolean;
}): void;
export declare function createDialog(options?: DialogOptions): Dialog;
