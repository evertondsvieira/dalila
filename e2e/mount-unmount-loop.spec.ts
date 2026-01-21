import { test, expect } from '@playwright/test';

test('mount/unmount loop does not accumulate effects', async ({ page }) => {
  await page.goto('/examples/tests/mount-unmount-loop.html');

  const loopBtn = page.locator('#loop');
  const triggerBtn = page.locator('#trigger');

  // Wait for initial effect to run
  await page.waitForTimeout(100);

  const initialRuns = await page.evaluate(() => window.__effectRuns);
  expect(initialRuns).toBeGreaterThan(0);

  // Trigger to count active effects before loop
  await triggerBtn.click();
  await page.waitForTimeout(100);

  const runsAfterTrigger1 = await page.evaluate(() => window.__effectRuns);
  const activeEffectsBefore = runsAfterTrigger1 - initialRuns;

  // Should have exactly 1 active effect before loop
  expect(activeEffectsBefore).toBe(1);

  // Run the loop (200 mount/unmount cycles)
  await loopBtn.click();

  // Wait for loop completion signal (deterministic)
  await page.waitForFunction(() => window.__loopDone === true, { timeout: 10000 });

  // Validate that we actually did 200 mounts
  const totalMounts = await page.evaluate(() => window.__mounts);
  expect(totalMounts).toBeGreaterThanOrEqual(201); // Initial mount + 200 remounts

  const runsAfterLoop = await page.evaluate(() => window.__effectRuns);

  // Trigger again to count active effects after loop
  await triggerBtn.click();
  await page.waitForTimeout(100);

  const finalRuns = await page.evaluate(() => window.__effectRuns);
  const activeEffectsAfter = finalRuns - runsAfterLoop;

  // CRITICAL: Should still have exactly 1 active effect after loop
  // If effects accumulated, we'd have 200+ effects triggering here
  expect(activeEffectsAfter).toBe(1);
});

test('effect runs correctly after mount/unmount', async ({ page }) => {
  await page.goto('/examples/tests/mount-unmount-loop.html');

  const triggerBtn = page.locator('#trigger');

  // Wait for initial render
  await page.waitForTimeout(50);

  const runs1 = await page.evaluate(() => window.__effectRuns);

  // Trigger signal update
  await triggerBtn.click();
  await page.waitForTimeout(50);

  const runs2 = await page.evaluate(() => window.__effectRuns);

  // Should have exactly 1 more run
  expect(runs2).toBe(runs1 + 1);

  // Trigger again
  await triggerBtn.click();
  await page.waitForTimeout(50);

  const runs3 = await page.evaluate(() => window.__effectRuns);

  // Should have exactly 1 more run
  expect(runs3).toBe(runs2 + 1);
});
