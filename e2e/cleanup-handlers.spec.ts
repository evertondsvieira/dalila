import { test, expect } from '@playwright/test';

test('when/match cleanup does not duplicate handlers', async ({ page }) => {
  await page.goto('/examples/tests/cleanup-handlers.html');

  const toggleBtn = page.locator('#toggle');
  const testBtn = page.locator('#test');
  const countDiv = page.locator('#count');

  // Initial state: Branch A is mounted
  await expect(page.locator('#increment')).toBeVisible();

  // Click increment button directly
  await page.locator('#increment').click();
  await expect(countDiv).toHaveText('1');

  // Toggle branch 50 times (mount/unmount Branch A repeatedly)
  for (let i = 0; i < 50; i++) {
    await toggleBtn.click();
    await page.waitForTimeout(10);
  }

  // After 50 toggles (even number), we're back on Branch A (same as initial state)
  // Wait a bit for the last microtask to complete
  await page.waitForTimeout(50);

  // Branch A should be mounted again
  await expect(page.locator('#increment')).toBeVisible();

  // Click the increment button
  await page.locator('#increment').click();
  await page.waitForTimeout(10);

  // Count should be 2 (not 52 or higher)
  // If handlers accumulated, clicking once would trigger multiple increments
  const clickCount = await page.evaluate(() => window.__clickCount);
  expect(clickCount).toBe(2);
});
