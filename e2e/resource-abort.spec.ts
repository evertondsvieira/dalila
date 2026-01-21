import { test, expect } from '@playwright/test';

test('resource fetch is aborted on branch unmount', async ({ page }) => {
  await page.goto('/examples/tests/resource-abort.html');

  const toggleBtn = page.locator('#toggle');
  const statusDiv = page.locator('#status');

  // Initial state: Branch A is mounted, resource starts fetching
  await expect(statusDiv).toContainText('Fetching');

  // Toggle to Branch B BEFORE fetch completes (200ms delay)
  await page.waitForTimeout(50);
  await toggleBtn.click();

  // Wait for abort to process
  await page.waitForTimeout(100);

  // Check that the fetch was aborted (not completed)
  const abortedCount = await page.evaluate(() => window.__abortedCount);
  const completedCount = await page.evaluate(() => window.__completedCount);

  expect(abortedCount).toBeGreaterThan(0);
  expect(completedCount).toBe(0);

  // Status should show "Aborted" (the resource was cancelled)
  await expect(statusDiv).toContainText('Aborted');
});

test('resource fetch completes if branch stays mounted', async ({ page }) => {
  await page.goto('/examples/tests/resource-abort.html');

  const statusDiv = page.locator('#status');

  // Initial state: Branch A is mounted, resource starts fetching
  await expect(statusDiv).toContainText('Fetching');

  // Wait for fetch to complete (200ms + buffer)
  await page.waitForTimeout(250);

  // Check that the fetch completed successfully
  const completedCount = await page.evaluate(() => window.__completedCount);
  expect(completedCount).toBeGreaterThan(0);

  await expect(statusDiv).toContainText('Completed');
});
