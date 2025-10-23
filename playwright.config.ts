import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  reporter: 'list',
  use: {
    viewport: { width: 1600, height: 900 },
    baseURL: 'http://127.0.0.1:4173',
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: 'pnpm exec vite dev --host 0.0.0.0 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/NASA/neo3d.html',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
