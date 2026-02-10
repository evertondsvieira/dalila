import type { Signal } from "../../../core/signal.js";
export declare function attachDialogBehavior(el: HTMLDialogElement, open: Signal<boolean>, closeFn: () => void, opts: {
    closeOnBackdrop: boolean;
    closeOnEscape: boolean;
}): void;
