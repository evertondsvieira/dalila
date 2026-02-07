import { test, expect } from '@playwright/test';

test.describe('UI Components E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/tests/ui-components.html');
    await page.waitForLoadState('networkidle');
  });

  // ── Dialog ──────────────────────────────────────────────────

  test('dialog opens and closes', async ({ page }) => {
    const dialog = page.locator('#test-dialog');
    await expect(dialog).not.toHaveAttribute('open');

    await page.click('#dialog-open');
    await expect(dialog).toHaveAttribute('open');

    await page.click('#dialog-close');
    await expect(dialog).not.toHaveAttribute('open');
  });

  test('dialog sets aria-modal', async ({ page }) => {
    const dialog = page.locator('#test-dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  // ── Drawer ─────────────────────────────────────────────────

  test('drawer opens with correct side class', async ({ page }) => {
    const drawer = page.locator('#test-drawer');
    await expect(drawer).toHaveClass(/d-drawer-left/);

    await page.click('#drawer-open');
    await expect(drawer).toHaveAttribute('open');

    await page.click('#drawer-close');
    await expect(drawer).not.toHaveAttribute('open');
  });

  // ── Dropdown ───────────────────────────────────────────────

  test('dropdown toggles on trigger click', async ({ page }) => {
    const isOpen = () => page.evaluate(() => (window as any).__dropdown.open());

    expect(await isOpen()).toBe(false);

    await page.click('#dropdown-trigger');
    expect(await isOpen()).toBe(true);

    await page.click('#dropdown-trigger');
    expect(await isOpen()).toBe(false);
  });

  test('dropdown closes on outside click', async ({ page }) => {
    await page.click('#dropdown-trigger');
    const isOpen = () => page.evaluate(() => (window as any).__dropdown.open());
    expect(await isOpen()).toBe(true);

    // Click outside the dropdown
    await page.click('body', { position: { x: 10, y: 10 } });
    await page.waitForTimeout(50);
    expect(await isOpen()).toBe(false);
  });

  test('dropdown sets ARIA attributes', async ({ page }) => {
    const trigger = page.locator('#dropdown-trigger');
    const menu = page.locator('#test-dropdown .d-menu');

    await expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toHaveAttribute('role', 'menu');

    await page.click('#dropdown-trigger');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  // ── Tabs ───────────────────────────────────────────────────

  test('tabs switch on click', async ({ page }) => {
    const getActive = () => page.evaluate(() => (window as any).__tabs.active());

    expect(await getActive()).toBe('alpha');

    await page.click('[data-tab="beta"]');
    expect(await getActive()).toBe('beta');

    await page.click('[data-tab="gamma"]');
    expect(await getActive()).toBe('gamma');
  });

  test('tabs set ARIA attributes', async ({ page }) => {
    const tabList = page.locator('#test-tabs .d-tab-list');
    await expect(tabList).toHaveAttribute('role', 'tablist');
    await expect(tabList).toHaveAttribute('aria-orientation', 'horizontal');

    const alphaTab = page.locator('[data-tab="alpha"]');
    const betaTab = page.locator('[data-tab="beta"]');

    await expect(alphaTab).toHaveAttribute('role', 'tab');
    await expect(alphaTab).toHaveAttribute('aria-selected', 'true');
    await expect(alphaTab).toHaveAttribute('tabindex', '0');

    await expect(betaTab).toHaveAttribute('aria-selected', 'false');
    await expect(betaTab).toHaveAttribute('tabindex', '-1');
  });

  test('tabs keyboard navigation with arrow keys', async ({ page }) => {
    const getActive = () => page.evaluate(() => (window as any).__tabs.active());

    // Focus the first tab
    await page.locator('[data-tab="alpha"]').focus();

    // ArrowRight → beta
    await page.keyboard.press('ArrowRight');
    expect(await getActive()).toBe('beta');

    // ArrowRight → gamma
    await page.keyboard.press('ArrowRight');
    expect(await getActive()).toBe('gamma');

    // ArrowRight wraps → alpha
    await page.keyboard.press('ArrowRight');
    expect(await getActive()).toBe('alpha');

    // ArrowLeft wraps → gamma
    await page.keyboard.press('ArrowLeft');
    expect(await getActive()).toBe('gamma');

    // Home → alpha
    await page.keyboard.press('Home');
    expect(await getActive()).toBe('alpha');

    // End → gamma
    await page.keyboard.press('End');
    expect(await getActive()).toBe('gamma');
  });

  // ── Combobox ───────────────────────────────────────────────

  test('combobox sets ARIA on attach', async ({ page }) => {
    const input = page.locator('#test-combobox input[type="text"]');
    const list = page.locator('#test-combobox ul');

    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-autocomplete', 'list');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toHaveAttribute('role', 'listbox');
  });

  test('combobox keyboard navigation selects value', async ({ page }) => {
    const input = page.locator('#test-combobox input[type="text"]');

    await input.focus();
    await page.keyboard.press('ArrowDown'); // open
    await page.keyboard.press('ArrowDown'); // highlight Apple
    await page.keyboard.press('ArrowDown'); // highlight Banana
    await page.keyboard.press('Enter');     // select Banana

    const value = await page.evaluate(() => (window as any).__combo.value());
    expect(value).toBe('banana');
  });

  test('combobox creates hidden input for form submission', async ({ page }) => {
    const hidden = page.locator('#test-combobox input[type="hidden"]');
    await expect(hidden).toHaveCount(1);
  });

  // ── Accordion ──────────────────────────────────────────────

  test('accordion open and close programmatic API', async ({ page }) => {
    const isOpen = (id: string) =>
      page.evaluate((id) => (window as any).__accordion.isOpen(id)(), id);

    expect(await isOpen('item1')).toBe(false);

    await page.evaluate(() => (window as any).__accordion.open('item1'));
    expect(await isOpen('item1')).toBe(true);

    await page.evaluate(() => (window as any).__accordion.close('item1'));
    expect(await isOpen('item1')).toBe(false);
  });

  test('accordion single mode closes others on open', async ({ page }) => {
    const isOpen = (id: string) =>
      page.evaluate((id) => (window as any).__accordion.isOpen(id)(), id);

    await page.evaluate(() => (window as any).__accordion.open('item1'));
    expect(await isOpen('item1')).toBe(true);

    await page.evaluate(() => (window as any).__accordion.open('item2'));
    expect(await isOpen('item2')).toBe(true);
    expect(await isOpen('item1')).toBe(false); // single mode
  });

  // ── Popover ────────────────────────────────────────────────

  test('popover sets ARIA on trigger', async ({ page }) => {
    const trigger = page.locator('#popover-trigger');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveAttribute('aria-controls', 'test-popover');
  });

  test('popover toggles open state', async ({ page }) => {
    const isOpen = () => page.evaluate(() => (window as any).__popover.open());

    expect(await isOpen()).toBe(false);

    await page.click('#popover-trigger');
    expect(await isOpen()).toBe(true);

    await page.click('#popover-trigger');
    expect(await isOpen()).toBe(false);
  });
});
