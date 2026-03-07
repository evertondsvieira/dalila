import { computed, signal } from '../../dist/core/index.js';
import {
  createDialog,
  createDrawer,
  createToast,
  createTabs,
  createDropdown,
  createCombobox,
  createDropzone,
  createCalendar,
  createPopover,
  mountUI,
} from '../../dist/components/ui/index.js';

const dialog = createDialog();
const drawer = createDrawer();
const sheet = createDrawer({ side: 'bottom' });
const toast = createToast();
const dropdown = createDropdown();
const combo = createCombobox({
  options: [
    { value: 'dalila', label: 'Dalila' },
    { value: 'react', label: 'React' },
    { value: 'vue', label: 'Vue' },
    { value: 'angular', label: 'Angular' },
    { value: 'svelte', label: 'Svelte' },
    { value: 'solid', label: 'Solid' },
  ],
});
const tabs1 = createTabs({ initial: 'tab1a' });
const tabs2 = createTabs({ initial: 'tab2a' });
const dz = createDropzone({ accept: '.png,.jpg,.pdf', maxSize: 10 * 1024 * 1024 });
const cal = createCalendar();
const pop = createPopover({ placement: 'bottom-start' });
const sliderValue = signal('50');
const MOBILE_SIDEBAR_BREAKPOINT = '(max-width: 840px)';
const sidebarCollapsed = signal(false);
const sidebarMobileOpen = signal(false);
const sidebarMobileViewport = signal(false);
const sidebarToggleClass = computed(() =>
  sidebarCollapsed() ? 'd-side-bar-floating-toggle collapsed' : 'd-side-bar-floating-toggle'
);
const sidebarClass = computed(() => {
  const classes = ['d-side-bar'];
  if (!sidebarMobileViewport() && sidebarCollapsed()) classes.push('collapsed');
  if (sidebarMobileViewport() && sidebarMobileOpen()) classes.push('mobile-open');
  return classes.join(' ');
});
const sidebarMobileToggleClass = computed(() =>
  sidebarMobileOpen() ? 'd-side-bar-toggle d-side-bar-mobile-toggle open' : 'd-side-bar-toggle d-side-bar-mobile-toggle'
);
const sidebarBackdropClass = computed(() =>
  sidebarMobileViewport() && sidebarMobileOpen() ? 'd-side-bar-backdrop visible' : 'd-side-bar-backdrop'
);
const sidebarExpanded = computed(() => String(!sidebarCollapsed()));
const sidebarToggleLabel = computed(() =>
  sidebarCollapsed() ? 'Expandir sidebar' : 'Recolher sidebar'
);
const sidebarMobileExpanded = computed(() => String(sidebarMobileOpen()));
const sidebarMobileToggleLabel = computed(() =>
  sidebarMobileOpen() ? 'Fechar menu lateral' : 'Abrir menu lateral'
);

function syncSidebarSections(root: ParentNode | null, collapsed: boolean) {
  if (!root) return;

  const sections = root.querySelectorAll<HTMLDetailsElement>('.d-side-bar-section');
  sections.forEach((section) => {
    if (collapsed) {
      section.dataset.wasOpen = section.open ? 'true' : 'false';
      section.open = true;
      return;
    }

    if (!('wasOpen' in section.dataset)) return;
    section.open = section.dataset.wasOpen === 'true';
    delete section.dataset.wasOpen;
  });
}

function setSidebarMobileOpen(nextOpen: boolean) {
  sidebarMobileOpen.set(nextOpen);
  document.body.classList.toggle('sidebar-mobile-open', nextOpen && sidebarMobileViewport());
}

function setSidebarMobileViewport(matches: boolean) {
  sidebarMobileViewport.set(matches);
  if (!matches) setSidebarMobileOpen(false);
}

if (typeof window !== 'undefined') {
  const mobileSidebarMedia = window.matchMedia(MOBILE_SIDEBAR_BREAKPOINT);
  const syncSidebarViewport = () => setSidebarMobileViewport(mobileSidebarMedia.matches);

  syncSidebarViewport();

  if (typeof mobileSidebarMedia.addEventListener === 'function') {
    mobileSidebarMedia.addEventListener('change', syncSidebarViewport);
  } else {
    mobileSidebarMedia.addListener(syncSidebarViewport);
  }

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && sidebarMobileViewport() && sidebarMobileOpen()) {
      setSidebarMobileOpen(false);
    }
  });
}

mountUI(document.body, {
  context: {
    sidebarClass,
    sidebarToggleClass,
    sidebarMobileToggleClass,
    sidebarBackdropClass,
    sidebarExpanded,
    sidebarToggleLabel,
    sidebarMobileExpanded,
    sidebarMobileToggleLabel,
    onSidebarToggle: (ev: Event) => {
      ev.preventDefault();

      if (sidebarMobileViewport()) {
        setSidebarMobileOpen(!sidebarMobileOpen());
        return;
      }

      const toggle =
        ev.currentTarget instanceof Element
          ? ev.currentTarget
          : ev.target instanceof Element
            ? ev.target
            : null;
      const sidebarShell = toggle?.closest('.d-side-bar-shell') ?? null;
      const nextCollapsed = !sidebarCollapsed();

      syncSidebarSections(sidebarShell, nextCollapsed);
      sidebarCollapsed.set(nextCollapsed);
    },
    closeSidebarMobileMenu: (ev: Event) => {
      ev.preventDefault();
      if (sidebarMobileViewport()) setSidebarMobileOpen(false);
    },
    onSidebarNavClick: (ev: Event) => {
      if (!sidebarMobileViewport()) return;
      const target = ev.target;
      if (target instanceof Element && target.closest('.d-side-bar-link')) {
        setSidebarMobileOpen(false);
      }
    },
  },
  sliderValue,
  dialogs: { dialog },
  drawers: { drawer, sheet },
  toasts: { toast },
  dropdowns: { dropdown },
  combos: { combo },
  tabs: {
    tabs1: {
      api: tabs1,
      bindings: [
        ['t1a', 'tab1a'],
        ['t1b', 'tab1b'],
        ['t1c', 'tab1c'],
      ],
    },
    tabs2: {
      api: tabs2,
      bindings: [
        ['t2a', 'tab2a'],
        ['t2b', 'tab2b'],
        ['t2c', 'tab2c'],
      ],
    },
  },
  dropzones: { dz },
  calendars: { cal },
  popovers: { popover: { api: pop } },
});
