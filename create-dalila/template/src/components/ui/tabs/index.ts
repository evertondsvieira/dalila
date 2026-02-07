import { signal, computed } from "../../../core/signal.js";
import { getCurrentScope } from "../../../core/scope.js";
import type { Tabs, TabBindings, TabsOptions } from "../ui-types.js";

export function createTabs(options: TabsOptions = {}): Tabs {
  const { initial = "", orientation = "horizontal" } = options;
  const active = signal(initial);

  const select = (tabId: string) => active.set(tabId);

  const isActive = (tabId: string): boolean => active() === tabId;

  const handleClick = (ev: Event) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>("[data-tab]");
    if (target && target.dataset.tab) {
      select(target.dataset.tab);
    }
  };

  const _attachTo = (el: HTMLElement) => {
    const scope = getCurrentScope();

    // ARIA setup
    const tabList = el.querySelector<HTMLElement>(
      "[data-d-tag='d-tab-list'], .d-tab-list"
    );
    if (tabList) {
      tabList.setAttribute("role", "tablist");
      tabList.setAttribute("aria-orientation", orientation);
    }

    const tabButtons = el.querySelectorAll<HTMLElement>("[data-tab]");
    const panels = el.querySelectorAll<HTMLElement>(
      "[data-d-tag='d-tab-panel'], .d-tab-panel"
    );

    tabButtons.forEach((btn, i) => {
      btn.setAttribute("role", "tab");
      const tabId = btn.dataset.tab!;
      const btnId = btn.id || `d-tab-${tabId}`;
      if (!btn.id) btn.id = btnId;

      if (panels[i]) {
        const panelId = panels[i].id || `d-tabpanel-${tabId}`;
        if (!panels[i].id) panels[i].id = panelId;
        panels[i].setAttribute("role", "tabpanel");
        panels[i].setAttribute("aria-labelledby", btnId);
        btn.setAttribute("aria-controls", panelId);
      }
    });

    const syncAria = (activeId: string) => {
      tabButtons.forEach((btn, i) => {
        const isAct = btn.dataset.tab === activeId;
        btn.setAttribute("aria-selected", String(isAct));
        btn.setAttribute("tabindex", isAct ? "0" : "-1");
        if (panels[i]) panels[i].setAttribute("aria-hidden", String(!isAct));
      });
    };

    // Apply initial state
    syncAria(active());

    const unsub = active.on(syncAria);

    // Keyboard navigation
    const prevKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight";

    const onKeydown = (ev: KeyboardEvent) => {
      const tabs = Array.from(tabButtons);
      const currentIndex = tabs.findIndex((btn) => btn.dataset.tab === active());
      let nextIndex = -1;

      switch (ev.key) {
        case nextKey:
          ev.preventDefault();
          nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
          break;
        case prevKey:
          ev.preventDefault();
          nextIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
          break;
        case "Home":
          ev.preventDefault();
          nextIndex = 0;
          break;
        case "End":
          ev.preventDefault();
          nextIndex = tabs.length - 1;
          break;
        default:
          return;
      }

      const nextTab = tabs[nextIndex];
      if (nextTab?.dataset.tab) {
        select(nextTab.dataset.tab);
        nextTab.focus();
      }
    };

    if (tabList) tabList.addEventListener("keydown", onKeydown);

    if (scope) {
      scope.onCleanup(() => {
        unsub();
        if (tabList) tabList.removeEventListener("keydown", onKeydown);
      });
    }
  };

  return { active, select, isActive, handleClick, _attachTo };
}

export function tabBindings(tabs: Tabs, tabId: string): TabBindings {
  const tabClass = computed(() =>
    tabs.active() === tabId ? "d-tab active" : "d-tab"
  );

  const selected = computed(() =>
    tabs.active() === tabId ? "true" : "false"
  );

  const visible = computed(() => tabs.active() === tabId);

  return { tabClass, selected, visible };
}
