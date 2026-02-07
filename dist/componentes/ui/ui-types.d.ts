import type { Signal } from "../../core/signal.js";
export interface DialogOptions {
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
}
export interface Dialog {
    open: Signal<boolean>;
    show(): void;
    close(): void;
    toggle(): void;
    _attachTo(el: HTMLDialogElement): void;
}
export type DrawerSide = "right" | "left" | "bottom";
export interface DrawerOptions extends DialogOptions {
    side?: DrawerSide;
}
export interface Drawer extends Dialog {
    side: Signal<DrawerSide>;
}
export type ToastVariant = "success" | "error" | "warning" | "info";
export type ToastPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";
export interface ToastItem {
    id: string;
    variant: ToastVariant;
    title: string;
    text?: string;
    variantClass: string;
    icon: string;
}
export interface ToastOptions {
    position?: ToastPosition;
    duration?: number;
    maxToasts?: number;
}
export interface Toast {
    items: Signal<ToastItem[]>;
    activeVariant: Signal<ToastVariant | "idle">;
    containerClass: Signal<string>;
    show(variant: ToastVariant, title: string, text?: string, duration?: number): string;
    success(title: string, text?: string): string;
    error(title: string, text?: string): string;
    warning(title: string, text?: string): string;
    info(title: string, text?: string): string;
    dismiss(id: string): void;
    clear(): void;
}
export interface TabsOptions {
    initial?: string;
    orientation?: "horizontal" | "vertical";
}
export interface Tabs {
    active: Signal<string>;
    select(tabId: string): void;
    isActive(tabId: string): boolean;
    handleClick(ev: Event): void;
    _attachTo(el: HTMLElement): void;
}
export interface TabBindings {
    tabClass: Signal<string>;
    selected: Signal<string>;
    visible: Signal<boolean>;
}
export interface DropdownOptions {
    closeOnSelect?: boolean;
}
export interface Dropdown {
    open: Signal<boolean>;
    toggle(ev?: Event): void;
    close(): void;
    select(ev?: Event): void;
    _attachTo(el: HTMLElement): void;
}
export interface ComboboxOption {
    value: string;
    label: string;
}
export interface ComboboxOptions {
    options: ComboboxOption[];
    placeholder?: string;
    name?: string;
}
export interface Combobox {
    open: Signal<boolean>;
    query: Signal<string>;
    value: Signal<string>;
    label: Signal<string>;
    filtered: Signal<ComboboxOption[]>;
    highlightedIndex: Signal<number>;
    show(): void;
    close(): void;
    toggle(): void;
    handleInput(ev: Event): void;
    handleSelect(ev: Event): void;
    handleKeydown(ev: KeyboardEvent): void;
    _attachTo(el: HTMLElement): void;
}
export interface AccordionOptions {
    single?: boolean;
    initial?: string[];
}
export interface Accordion {
    openItems: Signal<Set<string>>;
    toggle(itemId: string): void;
    open(itemId: string): void;
    close(itemId: string): void;
    isOpen(itemId: string): Signal<boolean>;
    _attachTo(el: HTMLElement): void;
}
export interface CalendarDay {
    date: number;
    month: "prev" | "current" | "next";
    fullDate: Date;
    isToday: boolean;
    isSelected: boolean;
    disabled: boolean;
}
export interface CalendarOptions {
    initial?: Date;
    min?: Date;
    max?: Date;
    dayLabels?: string[];
    monthLabels?: string[];
}
export interface Calendar {
    year: Signal<number>;
    month: Signal<number>;
    selected: Signal<Date | null>;
    title: Signal<string>;
    days: Signal<CalendarDay[]>;
    dayLabels: string[];
    prev(): void;
    next(): void;
    select(date: Date): void;
    handleDayClick(ev: Event): void;
}
export interface DropzoneOptions {
    accept?: string;
    multiple?: boolean;
    maxFiles?: number;
    maxSize?: number;
}
export interface Dropzone {
    dragging: Signal<boolean>;
    files: Signal<File[]>;
    browse(): void;
    handleClick(): void;
    handleDragover(ev: DragEvent): void;
    handleDragleave(): void;
    handleDrop(ev: DragEvent): void;
    _attachTo(el: HTMLElement): void;
}
export type PopoverPlacement = "top" | "bottom" | "left" | "right" | "top-start" | "bottom-start";
export interface PopoverOptions {
    placement?: PopoverPlacement;
    gap?: number;
    viewportPadding?: number;
}
export interface Popover {
    open: Signal<boolean>;
    placement: Signal<PopoverPlacement>;
    show(): void;
    hide(): void;
    toggle(): void;
    position(trigger: HTMLElement, popoverEl: HTMLElement): void;
    _attachTo(trigger: HTMLElement, popoverEl: HTMLElement): void;
}
export interface TabsMount {
    api: Tabs;
    bindings: [string, string][];
}
export interface PopoverMount {
    api: Popover;
    triggerId?: string;
    panelId?: string;
}
