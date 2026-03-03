import { test, expect } from '@playwright/test';

test('resource fetch is aborted on branch unmount', async ({ page }) => {
  await page.goto('/examples/tests/resource-abort.html');

  const app = page.locator('#app');
  const statusDiv = page.locator('#status');

  await expect
    .poll(() => page.evaluate(() => window.__startedCount), { timeout: 1500 })
    .toBeGreaterThan(0);
  await expect(statusDiv).toContainText('Fetching');

  // Use a DOM click to avoid cross-browser actionability overhead skewing timing.
  await page.evaluate(() => {
    (document.getElementById('toggle') as HTMLButtonElement | null)?.click();
  });
  await expect(app).toContainText('Branch B (No Resource)');

  await expect
    .poll(() => page.evaluate(() => window.__abortedCount), { timeout: 2000 })
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.__completedCount), { timeout: 2000 })
    .toBe(0);

  // Status should show "Aborted" (the resource was cancelled)
  await expect(statusDiv).toContainText('Aborted');
});

test('resource fetch completes if branch stays mounted', async ({ page }) => {
  await page.goto('/examples/tests/resource-abort.html');

  const statusDiv = page.locator('#status');

  await expect
    .poll(() => page.evaluate(() => window.__startedCount), { timeout: 1500 })
    .toBeGreaterThan(0);
  await expect(statusDiv).toContainText('Fetching');

  await expect
    .poll(() => page.evaluate(() => window.__completedCount), { timeout: 2500 })
    .toBeGreaterThan(0);

  await expect(statusDiv).toContainText('Completed');
});
