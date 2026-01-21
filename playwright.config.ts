import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI ? [['list'], ['html']] : 'html',

  timeout: process.env.CI ? 60_000 : 30_000,

  expect: {
    timeout: 5_000,
  },

  use: {
    baseURL: 'http://localhost:4242',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run serve',
    url: 'http://localhost:4242',
    reuseExistingServer: !process.env.CI,
  },
});
