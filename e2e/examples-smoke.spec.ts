import { test, expect } from '@playwright/test';

const EXAMPLES = [
  { path: '/examples/playground/index.html', title: /Dalila Playground/i, heading: /Dalila/i },
  { path: '/examples/ui/index.html', title: /Dalila UI/i, heading: /Dalila UI/i },
  { path: '/examples/virtual-list/index.html', title: /d-each vs d-virtual-each/i, heading: /d-each vs d-virtual-each/i },
];

test.describe('Examples smoke', () => {
  for (const example of EXAMPLES) {
    test(`loads ${example.path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(String(err)));

      const response = await page.goto(example.path, { waitUntil: 'domcontentloaded' });
      expect(response?.ok()).toBeTruthy();

      await expect(page).toHaveTitle(example.title);
      await expect(page.getByRole('heading').first()).toContainText(example.heading);

      // Give Dalila bind() a small window to settle and remove loading attrs on examples.
      await page.waitForTimeout(200);
      expect(errors, `page errors on ${example.path}`).toEqual([]);
    });
  }
});

