import { type Signal } from "../../core/signal.js";
import { type BindContext } from "../../runtime/bind.js";
import type { Calendar, Combobox, Dialog, Drawer, Dropdown, Dropzone, PopoverMount, TabsMount, Toast } from "./ui-types.js";
export interface MountUIOptions {
    context?: BindContext;
    events?: string[];
    theme?: boolean;
    sliderValue?: Signal<string>;
    dialogs?: Record<string, Dialog>;
    drawers?: Record<string, Drawer>;
    dropdowns?: Record<string, Dropdown>;
    combos?: Record<string, Combobox>;
    tabs?: Record<string, TabsMount>;
    toasts?: Record<string, Toast>;
    popovers?: Record<string, PopoverMount>;
    dropzones?: Record<string, Dropzone>;
    calendars?: Record<string, Calendar>;
    accordions?: Record<string, import("./ui-types.js").Accordion>;
}
export declare function mountUI(root: Element, options: MountUIOptions): () => void;
