import { signal, computed } from "../../../core/signal.js";
import { batch } from "../../../core/scheduler.js";
import type { Calendar, CalendarDay, CalendarOptions } from "../ui-types.js";
import { validateCalendarOptions } from "../validate.js";

const DEFAULT_DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DEFAULT_MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function createCalendar(options: CalendarOptions = {}): Calendar {
  validateCalendarOptions(options as Record<string, unknown>);
  const {
    initial,
    min,
    max,
    dayLabels: customDayLabels,
    monthLabels: customMonthLabels,
  } = options;

  const now = initial ?? new Date();
  const monthLabels = customMonthLabels ?? DEFAULT_MONTH_LABELS;
  const calDayLabels = customDayLabels ?? DEFAULT_DAY_LABELS;

  const year = signal(now.getFullYear());
  const month = signal(now.getMonth());
  const selected = signal<Date | null>(initial ?? null);

  const title = computed(() => `${monthLabels[month()]} ${year()}`);

  const days = computed<CalendarDay[]>(() => {
    const y = year();
    const m = month();
    const sel = selected();
    const today = new Date();

    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const prevMonthDays = new Date(y, m, 0).getDate();

    const grid: CalendarDay[] = [];
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

  function isOutOfBounds(date: Date): boolean {
    if (min && date < min) return true;
    if (max && date > max) return true;
    return false;
  }

  const prev = () => {
    batch(() => {
      if (month() === 0) {
        month.set(11);
        year.update((y) => y - 1);
      } else {
        month.update((m) => m - 1);
      }
    });
  };

  const next = () => {
    batch(() => {
      if (month() === 11) {
        month.set(0);
        year.update((y) => y + 1);
      } else {
        month.update((m) => m + 1);
      }
    });
  };

  const select = (date: Date) => {
    if (isOutOfBounds(date)) return;
    selected.set(date);
  };

  const handleDayClick = (ev: Event) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>(
      "[data-date]"
    );
    if (!target) return;

    const dateStr = target.dataset.date;
    if (!dateStr) return;

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return;

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
