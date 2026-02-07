import { signal, computed } from "../core/signal.js";
import { batch } from "../core/scheduler.js";
import { validateCalendarOptions } from "./validate.js";
const DEFAULT_DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DEFAULT_MONTH_LABELS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];
function isSameDay(a, b) {
    return (a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate());
}
export function createCalendar(options = {}) {
    validateCalendarOptions(options);
    const { initial, min, max, dayLabels: customDayLabels, monthLabels: customMonthLabels, } = options;
    const now = initial ?? new Date();
    const monthLabels = customMonthLabels ?? DEFAULT_MONTH_LABELS;
    const calDayLabels = customDayLabels ?? DEFAULT_DAY_LABELS;
    const year = signal(now.getFullYear());
    const month = signal(now.getMonth());
    const selected = signal(initial ?? null);
    const title = computed(() => `${monthLabels[month()]} ${year()}`);
    const days = computed(() => {
        const y = year();
        const m = month();
        const sel = selected();
        const today = new Date();
        const firstDow = new Date(y, m, 1).getDay();
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const prevMonthDays = new Date(y, m, 0).getDate();
        const grid = [];
        const GRID_SIZE = 42;
        // Previous month days
        for (let i = firstDow - 1; i >= 0; i--) {
            const date = prevMonthDays - i;
            const fullDate = new Date(y, m - 1, date);
            grid.push({
                date,
                month: "prev",
                fullDate,
                isToday: isSameDay(fullDate, today),
                isSelected: sel !== null && isSameDay(fullDate, sel),
                disabled: isOutOfBounds(fullDate),
            });
        }
        // Current month days
        for (let d = 1; d <= daysInMonth; d++) {
            const fullDate = new Date(y, m, d);
            grid.push({
                date: d,
                month: "current",
                fullDate,
                isToday: isSameDay(fullDate, today),
                isSelected: sel !== null && isSameDay(fullDate, sel),
                disabled: isOutOfBounds(fullDate),
            });
        }
        // Next month days
        const remaining = GRID_SIZE - grid.length;
        for (let d = 1; d <= remaining; d++) {
            const fullDate = new Date(y, m + 1, d);
            grid.push({
                date: d,
                month: "next",
                fullDate,
                isToday: isSameDay(fullDate, today),
                isSelected: sel !== null && isSameDay(fullDate, sel),
                disabled: isOutOfBounds(fullDate),
            });
        }
        return grid;
    });
    function isOutOfBounds(date) {
        if (min && date < min)
            return true;
        if (max && date > max)
            return true;
        return false;
    }
    const prev = () => {
        batch(() => {
            if (month() === 0) {
                month.set(11);
                year.update((y) => y - 1);
            }
            else {
                month.update((m) => m - 1);
            }
        });
    };
    const next = () => {
        batch(() => {
            if (month() === 11) {
                month.set(0);
                year.update((y) => y + 1);
            }
            else {
                month.update((m) => m + 1);
            }
        });
    };
    const select = (date) => {
        if (isOutOfBounds(date))
            return;
        selected.set(date);
    };
    const handleDayClick = (ev) => {
        const target = ev.target.closest("[data-date]");
        if (!target)
            return;
        const dateStr = target.dataset.date;
        if (!dateStr)
            return;
        const date = new Date(dateStr);
        if (isNaN(date.getTime()))
            return;
        select(date);
    };
    return {
        year,
        month,
        selected,
        title,
        days,
        dayLabels: calDayLabels,
        prev,
        next,
        select,
        handleDayClick,
    };
}
