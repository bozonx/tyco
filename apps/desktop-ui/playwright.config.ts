import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: process.env.TYCO_BROWSER_PATH
          ? { executablePath: process.env.TYCO_BROWSER_PATH }
          : {},
      },
    },
    // Visual baselines belong to the pinned Chromium/Linux environment.
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
      grepInvert: /@visual|@chromium/,
    },
  ],
  snapshotPathTemplate:
    '{testDir}/{testFilePath}-snapshots/{arg}-{platform}{ext}',
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'pnpm exec vite build --mode browser-test && pnpm exec vite preview --mode browser-test --host 127.0.0.1 --port 3100 --strictPort',
    url: 'http://127.0.0.1:3100/ui-catalog.html',
    // Browser checks must use locked dependencies, never a developer's checkout.
    env: { TYCO_LOCAL_AI_KIT: '' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
