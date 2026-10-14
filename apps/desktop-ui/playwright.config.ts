import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    launchOptions: {
      ...(process.env.TYCO_BROWSER_PATH
        ? { executablePath: process.env.TYCO_BROWSER_PATH }
        : {}),
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 3100 --strictPort',
    url: 'http://127.0.0.1:3100/ui-catalog.html',
    reuseExistingServer: false,
  },
})
