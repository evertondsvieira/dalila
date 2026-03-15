import type { Signal } from "dalila/core/signal";
export declare function attachDialogBehavior(el: HTMLDialogElement, open: Signal<boolean>, closeFn: () => void, opts: {
    closeOnBackdrop: boolean;
    closeOnEscape: boolean;
}): void;
