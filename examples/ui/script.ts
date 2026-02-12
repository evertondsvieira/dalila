import { signal } from '../../dist/core/index.js';
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

mountUI(document.body, {
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
