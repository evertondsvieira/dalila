/**
 * Tests for Dalila UI components
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

let dom, document, window;

const flush = () => new Promise(r => setTimeout(r, 10));

function setupDOM() {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
  });
  document = dom.window.document;
  window = dom.window;
  global.document = document;
  global.window = window;
  global.HTMLElement = window.HTMLElement;
  global.HTMLDialogElement = window.HTMLDialogElement;
  global.MouseEvent = window.MouseEvent;
  global.Event = window.Event;
  global.KeyboardEvent = window.KeyboardEvent;
  global.Node = window.Node;
}

function mockDialog(doc) {
  const el = doc.createElement('dialog');
  // JSDOM doesn't implement showModal/close on dialog
  el.showModal = function () { this.open = true; };
  el.close = function () { this.open = false; };
  return el;
}

// ── Dialog tests ────────────────────────────────────────────────────

describe('createDialog', () => {
  beforeEach(setupDOM);

  it('should create a dialog with default options', async () => {
    const { createDialog } = await import('../dist/ui/dialog.js');
    const dialog = createDialog();

    assert.strictEqual(dialog.open(), false);
    assert.strictEqual(typeof dialog.show, 'function');
    assert.strictEqual(typeof dialog.close, 'function');
    assert.strictEqual(typeof dialog.toggle, 'function');
    assert.strictEqual(typeof dialog._attachTo, 'function');
  });

  it('should toggle open state', async () => {
    const { createDialog } = await import('../dist/ui/dialog.js');
    const dialog = createDialog();

    dialog.show();
    assert.strictEqual(dialog.open(), true);

    dialog.close();
    assert.strictEqual(dialog.open(), false);

    dialog.toggle();
    assert.strictEqual(dialog.open(), true);

    dialog.toggle();
    assert.strictEqual(dialog.open(), false);
  });

  it('should sync signal to native dialog element', async () => {
    const { createDialog } = await import('../dist/ui/dialog.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const dialog = createDialog();
    const el = mockDialog(document);
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      dialog._attachTo(el);
    });

    dialog.show();
    await flush();
    assert.strictEqual(el.open, true);

    dialog.close();
    await flush();
    assert.strictEqual(el.open, false);

    scope.dispose();
  });

  it('should set aria-modal on attach', async () => {
    const { createDialog } = await import('../dist/ui/dialog.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const dialog = createDialog();
    const el = mockDialog(document);
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      dialog._attachTo(el);
    });

    assert.strictEqual(el.getAttribute('aria-modal'), 'true');
    scope.dispose();
  });
});

// ── Drawer tests ────────────────────────────────────────────────────

describe('createDrawer', () => {
  beforeEach(setupDOM);

  it('should default to right side', async () => {
    const { createDrawer } = await import('../dist/ui/drawer.js');
    const drawer = createDrawer();

    assert.strictEqual(drawer.side(), 'right');
  });

  it('should accept initial side option', async () => {
    const { createDrawer } = await import('../dist/ui/drawer.js');
    const drawer = createDrawer({ side: 'left' });

    assert.strictEqual(drawer.side(), 'left');
  });

  it('should apply side class on attach', async () => {
    const { createDrawer } = await import('../dist/ui/drawer.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const drawer = createDrawer({ side: 'left' });
    const el = mockDialog(document);
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      drawer._attachTo(el);
    });

    assert.strictEqual(el.classList.contains('d-drawer-left'), true);
    scope.dispose();
  });

  it('should apply d-sheet class for bottom side', async () => {
    const { createDrawer } = await import('../dist/ui/drawer.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const drawer = createDrawer({ side: 'bottom' });
    const el = mockDialog(document);
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      drawer._attachTo(el);
    });

    assert.strictEqual(el.classList.contains('d-sheet'), true);
    scope.dispose();
  });

  it('should not add extra class for right side (default)', async () => {
    const { createDrawer } = await import('../dist/ui/drawer.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const drawer = createDrawer({ side: 'right' });
    const el = mockDialog(document);
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      drawer._attachTo(el);
    });

    assert.strictEqual(el.classList.contains('d-drawer-left'), false);
    assert.strictEqual(el.classList.contains('d-sheet'), false);
    scope.dispose();
  });

  it('should react to side signal changes', async () => {
    const { createDrawer } = await import('../dist/ui/drawer.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const drawer = createDrawer({ side: 'right' });
    const el = mockDialog(document);
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      drawer._attachTo(el);
    });

    // Change to left
    drawer.side.set('left');
    await flush();
    assert.strictEqual(el.classList.contains('d-drawer-left'), true);
    assert.strictEqual(el.classList.contains('d-sheet'), false);

    // Change to bottom
    drawer.side.set('bottom');
    await flush();
    assert.strictEqual(el.classList.contains('d-sheet'), true);
    assert.strictEqual(el.classList.contains('d-drawer-left'), false);

    scope.dispose();
  });

  it('should sync open state with native dialog', async () => {
    const { createDrawer } = await import('../dist/ui/drawer.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const drawer = createDrawer({ side: 'left' });
    const el = mockDialog(document);
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      drawer._attachTo(el);
    });

    drawer.show();
    await flush();
    assert.strictEqual(el.open, true);
    assert.strictEqual(el.classList.contains('d-drawer-left'), true);

    drawer.close();
    await flush();
    assert.strictEqual(el.open, false);

    scope.dispose();
  });
});

// ── Popover tests ───────────────────────────────────────────────────

describe('createPopover', () => {
  beforeEach(setupDOM);

  it('should create a popover with default options', async () => {
    const { createPopover } = await import('../dist/ui/popover.js');
    const popover = createPopover();

    assert.strictEqual(popover.open(), false);
    assert.strictEqual(popover.placement(), 'bottom');
    assert.strictEqual(typeof popover.show, 'function');
    assert.strictEqual(typeof popover.hide, 'function');
    assert.strictEqual(typeof popover.toggle, 'function');
    assert.strictEqual(typeof popover.position, 'function');
    assert.strictEqual(typeof popover._attachTo, 'function');
  });

  it('should toggle open signal', async () => {
    const { createPopover } = await import('../dist/ui/popover.js');
    const popover = createPopover();

    popover.show();
    assert.strictEqual(popover.open(), true);

    popover.hide();
    assert.strictEqual(popover.open(), false);

    popover.toggle();
    assert.strictEqual(popover.open(), true);
  });

  it('should accept custom placement', async () => {
    const { createPopover } = await import('../dist/ui/popover.js');
    const popover = createPopover({ placement: 'top-start' });

    assert.strictEqual(popover.placement(), 'top-start');
  });

  it('should set ARIA attributes on _attachTo', async () => {
    const { createPopover } = await import('../dist/ui/popover.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const popover = createPopover();
    const trigger = document.createElement('button');
    const panel = document.createElement('div');
    document.body.appendChild(trigger);
    document.body.appendChild(panel);

    const scope = createScope();
    withScope(scope, () => {
      popover._attachTo(trigger, panel);
    });

    assert.strictEqual(trigger.getAttribute('aria-haspopup'), 'true');
    assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');
    assert.ok(trigger.getAttribute('aria-controls'));
    assert.strictEqual(panel.hasAttribute('popover'), true);

    scope.dispose();
  });

  it('should sync aria-expanded with open signal', async () => {
    const { createPopover } = await import('../dist/ui/popover.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const popover = createPopover();
    const trigger = document.createElement('button');
    const panel = document.createElement('div');
    document.body.appendChild(trigger);
    document.body.appendChild(panel);

    const scope = createScope();
    withScope(scope, () => {
      popover._attachTo(trigger, panel);
    });

    assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');

    popover.show();
    await flush();
    assert.strictEqual(trigger.getAttribute('aria-expanded'), 'true');

    popover.hide();
    await flush();
    assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');

    scope.dispose();
  });
});

// ── Dropdown tests ──────────────────────────────────────────────────

describe('createDropdown', () => {
  beforeEach(setupDOM);

  it('should toggle open state', async () => {
    const { createDropdown } = await import('../dist/ui/dropdown.js');
    const dd = createDropdown();

    assert.strictEqual(dd.open(), false);

    dd.toggle();
    assert.strictEqual(dd.open(), true);

    dd.close();
    assert.strictEqual(dd.open(), false);
  });

  it('should close on select when closeOnSelect is true', async () => {
    const { createDropdown } = await import('../dist/ui/dropdown.js');
    const dd = createDropdown({ closeOnSelect: true });

    dd.toggle();
    assert.strictEqual(dd.open(), true);

    dd.select();
    assert.strictEqual(dd.open(), false);
  });

  it('should set ARIA attributes on _attachTo', async () => {
    const { createDropdown } = await import('../dist/ui/dropdown.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const dd = createDropdown();
    const el = document.createElement('div');
    const btn = document.createElement('button');
    const menu = document.createElement('div');
    menu.classList.add('d-menu');
    el.appendChild(btn);
    el.appendChild(menu);
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      dd._attachTo(el);
    });

    assert.strictEqual(btn.getAttribute('aria-haspopup'), 'true');
    assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(menu.getAttribute('role'), 'menu');

    scope.dispose();
  });

  it('should sync aria-expanded on open', async () => {
    const { createDropdown } = await import('../dist/ui/dropdown.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const dd = createDropdown();
    const el = document.createElement('div');
    const btn = document.createElement('button');
    const menu = document.createElement('div');
    menu.classList.add('d-menu');
    el.appendChild(btn);
    el.appendChild(menu);
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      dd._attachTo(el);
    });

    dd.toggle();
    await flush();
    assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');

    dd.close();
    await flush();
    assert.strictEqual(btn.getAttribute('aria-expanded'), 'false');

    scope.dispose();
  });
});

// ── Combobox tests ──────────────────────────────────────────────────

describe('createCombobox', () => {
  beforeEach(setupDOM);

  it('should filter options by query', async () => {
    const { createCombobox } = await import('../dist/ui/combobox.js');
    const combo = createCombobox({
      options: [
        { value: '1', label: 'Apple' },
        { value: '2', label: 'Banana' },
        { value: '3', label: 'Cherry' },
      ],
    });

    assert.strictEqual(combo.filtered().length, 3);

    combo.query.set('an');
    assert.strictEqual(combo.filtered().length, 1);
    assert.strictEqual(combo.filtered()[0].label, 'Banana');
  });

  it('should handle keyboard navigation', async () => {
    const { createCombobox } = await import('../dist/ui/combobox.js');
    const combo = createCombobox({
      options: [
        { value: '1', label: 'Apple' },
        { value: '2', label: 'Banana' },
      ],
    });

    // Open with ArrowDown
    const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
    Object.defineProperty(downEvent, 'preventDefault', { value: () => {} });
    combo.handleKeydown(downEvent);
    assert.strictEqual(combo.open(), true);

    // Navigate
    combo.handleKeydown(downEvent);
    assert.strictEqual(combo.highlightedIndex(), 0);

    combo.handleKeydown(downEvent);
    assert.strictEqual(combo.highlightedIndex(), 1);

    // Select with Enter
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(enterEvent, 'preventDefault', { value: () => {} });
    combo.handleKeydown(enterEvent);
    assert.strictEqual(combo.value(), '2');
    assert.strictEqual(combo.label(), 'Banana');
    assert.strictEqual(combo.open(), false);
  });

  it('should close on Escape', async () => {
    const { createCombobox } = await import('../dist/ui/combobox.js');
    const combo = createCombobox({
      options: [{ value: '1', label: 'Apple' }],
    });

    combo.show();
    assert.strictEqual(combo.open(), true);

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    combo.handleKeydown(escEvent);
    assert.strictEqual(combo.open(), false);
  });

  it('should set ARIA on _attachTo', async () => {
    const { createCombobox } = await import('../dist/ui/combobox.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const combo = createCombobox({
      options: [{ value: '1', label: 'Apple' }],
    });

    const el = document.createElement('div');
    const input = document.createElement('input');
    const list = document.createElement('ul');
    el.appendChild(input);
    el.appendChild(list);
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      combo._attachTo(el);
    });

    assert.strictEqual(input.getAttribute('role'), 'combobox');
    assert.strictEqual(input.getAttribute('aria-autocomplete'), 'list');
    assert.strictEqual(input.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(list.getAttribute('role'), 'listbox');
    assert.ok(input.getAttribute('aria-controls'));

    scope.dispose();
  });
});

// ── Accordion tests ─────────────────────────────────────────────────

describe('createAccordion', () => {
  beforeEach(setupDOM);

  it('should toggle items', async () => {
    const { createAccordion } = await import('../dist/ui/accordion.js');
    const acc = createAccordion();

    acc.toggle('a');
    assert.strictEqual(acc.openItems().has('a'), true);

    acc.toggle('a');
    assert.strictEqual(acc.openItems().has('a'), false);
  });

  it('should enforce single-open mode', async () => {
    const { createAccordion } = await import('../dist/ui/accordion.js');
    const acc = createAccordion({ single: true });

    acc.toggle('a');
    assert.strictEqual(acc.openItems().has('a'), true);

    acc.toggle('b');
    assert.strictEqual(acc.openItems().has('b'), true);
    assert.strictEqual(acc.openItems().has('a'), false);
  });

  it('should support initial open items', async () => {
    const { createAccordion } = await import('../dist/ui/accordion.js');
    const acc = createAccordion({ initial: ['x', 'y'] });

    assert.strictEqual(acc.openItems().has('x'), true);
    assert.strictEqual(acc.openItems().has('y'), true);
  });

  it('isOpen should return a reactive Signal', async () => {
    const { createAccordion } = await import('../dist/ui/accordion.js');
    const acc = createAccordion();

    const isOpenA = acc.isOpen('a');
    // Should be a signal (callable)
    assert.strictEqual(typeof isOpenA, 'function');
    assert.strictEqual(isOpenA(), false);

    acc.toggle('a');
    assert.strictEqual(isOpenA(), true);

    acc.toggle('a');
    assert.strictEqual(isOpenA(), false);
  });

  it('isOpen should return cached signal for same itemId', async () => {
    const { createAccordion } = await import('../dist/ui/accordion.js');
    const acc = createAccordion();

    const sig1 = acc.isOpen('test');
    const sig2 = acc.isOpen('test');

    assert.strictEqual(sig1, sig2);
  });
});

// ── Tabs tests ──────────────────────────────────────────────────────

describe('createTabs', () => {
  beforeEach(setupDOM);

  it('should manage active tab', async () => {
    const { createTabs } = await import('../dist/ui/tabs.js');
    const tabs = createTabs({ initial: 'home' });

    assert.strictEqual(tabs.active(), 'home');
    assert.strictEqual(tabs.isActive('home'), true);
    assert.strictEqual(tabs.isActive('settings'), false);

    tabs.select('settings');
    assert.strictEqual(tabs.active(), 'settings');
    assert.strictEqual(tabs.isActive('settings'), true);
    assert.strictEqual(tabs.isActive('home'), false);
  });

  it('should set ARIA attributes on _attachTo', async () => {
    const { createTabs } = await import('../dist/ui/tabs.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const tabs = createTabs({ initial: 'tab1' });

    const el = document.createElement('div');
    el.innerHTML = `
      <div class="d-tab-list">
        <button data-tab="tab1">Tab 1</button>
        <button data-tab="tab2">Tab 2</button>
      </div>
      <div class="d-tab-panel">Panel 1</div>
      <div class="d-tab-panel">Panel 2</div>
    `;
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      tabs._attachTo(el);
    });

    const tabList = el.querySelector('.d-tab-list');
    const btns = el.querySelectorAll('[data-tab]');
    const panels = el.querySelectorAll('.d-tab-panel');

    assert.strictEqual(tabList.getAttribute('role'), 'tablist');
    assert.strictEqual(btns[0].getAttribute('role'), 'tab');
    assert.strictEqual(btns[0].getAttribute('aria-selected'), 'true');
    assert.strictEqual(btns[0].getAttribute('tabindex'), '0');
    assert.strictEqual(btns[1].getAttribute('aria-selected'), 'false');
    assert.strictEqual(btns[1].getAttribute('tabindex'), '-1');
    assert.strictEqual(panels[0].getAttribute('role'), 'tabpanel');
    assert.strictEqual(panels[0].getAttribute('aria-hidden'), 'false');
    assert.strictEqual(panels[1].getAttribute('aria-hidden'), 'true');

    // Switch tab
    tabs.select('tab2');
    await flush();
    assert.strictEqual(btns[0].getAttribute('aria-selected'), 'false');
    assert.strictEqual(btns[1].getAttribute('aria-selected'), 'true');
    assert.strictEqual(panels[0].getAttribute('aria-hidden'), 'true');
    assert.strictEqual(panels[1].getAttribute('aria-hidden'), 'false');

    scope.dispose();
  });
});

// ── Calendar tests ──────────────────────────────────────────────────

describe('createCalendar', () => {
  beforeEach(setupDOM);

  it('should initialize with current date', async () => {
    const { createCalendar } = await import('../dist/ui/calendar.js');
    const cal = createCalendar();

    const now = new Date();
    assert.strictEqual(cal.year(), now.getFullYear());
    assert.strictEqual(cal.month(), now.getMonth());
  });

  it('should navigate months', async () => {
    const { createCalendar } = await import('../dist/ui/calendar.js');
    const cal = createCalendar({ initial: new Date(2024, 5, 15) }); // June 2024

    cal.next();
    assert.strictEqual(cal.month(), 6); // July

    cal.prev();
    assert.strictEqual(cal.month(), 5); // June

    cal.prev();
    assert.strictEqual(cal.month(), 4); // May
  });

  it('should wrap around year boundaries', async () => {
    const { createCalendar } = await import('../dist/ui/calendar.js');
    const cal = createCalendar({ initial: new Date(2024, 0, 15) }); // January

    cal.prev();
    assert.strictEqual(cal.month(), 11); // December
    assert.strictEqual(cal.year(), 2023);

    cal.next();
    assert.strictEqual(cal.month(), 0); // January
    assert.strictEqual(cal.year(), 2024);
  });

  it('should select a date', async () => {
    const { createCalendar } = await import('../dist/ui/calendar.js');
    const cal = createCalendar();

    const date = new Date(2024, 5, 15);
    cal.select(date);
    assert.deepStrictEqual(cal.selected(), date);
  });

  it('should respect min/max constraints', async () => {
    const { createCalendar } = await import('../dist/ui/calendar.js');
    const min = new Date(2024, 5, 10);
    const max = new Date(2024, 5, 20);
    const cal = createCalendar({ min, max });

    // Select within range works
    const inRange = new Date(2024, 5, 15);
    cal.select(inRange);
    assert.deepStrictEqual(cal.selected(), inRange);

    // Try to select outside range — should not change
    const outOfRange = new Date(2024, 5, 5);
    cal.select(outOfRange);
    assert.deepStrictEqual(cal.selected(), inRange); // unchanged
  });

  it('should generate 42-day grid', async () => {
    const { createCalendar } = await import('../dist/ui/calendar.js');
    const cal = createCalendar({ initial: new Date(2024, 5, 15) });

    assert.strictEqual(cal.days().length, 42);
  });

  it('should mark today correctly', async () => {
    const { createCalendar } = await import('../dist/ui/calendar.js');
    const cal = createCalendar();

    const days = cal.days();
    const todayEntries = days.filter(d => d.isToday);
    assert.strictEqual(todayEntries.length, 1);
  });
});

// ── Toast tests ─────────────────────────────────────────────────────

describe('createToast', () => {
  beforeEach(setupDOM);

  it('should show and dismiss toasts', async () => {
    const { createToast } = await import('../dist/ui/toast.js');
    const toast = createToast();

    assert.strictEqual(toast.items().length, 0);

    const id = toast.success('Done!');
    assert.strictEqual(toast.items().length, 1);
    assert.strictEqual(toast.items()[0].variant, 'success');

    toast.dismiss(id);
    assert.strictEqual(toast.items().length, 0);
  });

  it('should respect maxToasts', async () => {
    const { createToast } = await import('../dist/ui/toast.js');
    const toast = createToast({ maxToasts: 2 });

    toast.info('1');
    toast.info('2');
    toast.info('3');

    assert.strictEqual(toast.items().length, 2);
  });

  it('should clear all toasts', async () => {
    const { createToast } = await import('../dist/ui/toast.js');
    const toast = createToast();

    toast.success('A');
    toast.error('B');
    toast.warning('C');

    assert.strictEqual(toast.items().length, 3);

    toast.clear();
    assert.strictEqual(toast.items().length, 0);
    assert.strictEqual(toast.activeVariant(), 'idle');
  });

  it('should have correct variant methods', async () => {
    const { createToast } = await import('../dist/ui/toast.js');
    const toast = createToast({ duration: 0 }); // No auto-dismiss

    toast.success('s');
    assert.strictEqual(toast.items()[0].variant, 'success');
    toast.clear();

    toast.error('e');
    assert.strictEqual(toast.items()[0].variant, 'error');
    toast.clear();

    toast.warning('w');
    assert.strictEqual(toast.items()[0].variant, 'warning');
    toast.clear();

    toast.info('i');
    assert.strictEqual(toast.items()[0].variant, 'info');
  });
});

// ── Dropzone tests ──────────────────────────────────────────────────

describe('createDropzone', () => {
  beforeEach(setupDOM);

  it('should track dragging state', async () => {
    const { createDropzone } = await import('../dist/ui/dropzone.js');
    const dz = createDropzone();

    assert.strictEqual(dz.dragging(), false);
  });

  it('should set ARIA on _attachTo', async () => {
    const { createDropzone } = await import('../dist/ui/dropzone.js');
    const { createScope, withScope } = await import('../dist/core/scope.js');

    const dz = createDropzone();
    const el = document.createElement('div');
    document.body.appendChild(el);

    const scope = createScope();
    withScope(scope, () => {
      dz._attachTo(el);
    });

    assert.strictEqual(el.getAttribute('role'), 'button');
    assert.strictEqual(el.getAttribute('tabindex'), '0');

    scope.dispose();
  });
});

// ── tabBindings tests ───────────────────────────────────────────────

describe('tabBindings', () => {
  beforeEach(setupDOM);

  it('should provide reactive bindings', async () => {
    const { createTabs, tabBindings } = await import('../dist/ui/tabs.js');
    const tabs = createTabs({ initial: 'a' });

    const bindA = tabBindings(tabs, 'a');
    const bindB = tabBindings(tabs, 'b');

    assert.strictEqual(bindA.tabClass(), 'd-tab active');
    assert.strictEqual(bindA.visible(), true);
    assert.strictEqual(bindB.tabClass(), 'd-tab');
    assert.strictEqual(bindB.visible(), false);

    tabs.select('b');
    assert.strictEqual(bindA.tabClass(), 'd-tab');
    assert.strictEqual(bindA.visible(), false);
    assert.strictEqual(bindB.tabClass(), 'd-tab active');
    assert.strictEqual(bindB.visible(), true);
  });
});
