import type { Toast, ToastOptions, ToastVariant } from "../ui-types.js";
export declare function createToast(options?: ToastOptions): Toast;
export declare function toastIcon(variant: () => ToastVariant | "idle"): DocumentFragment;
