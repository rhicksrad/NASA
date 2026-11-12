import { defineConfig } from '@playwright/test';

// CI sets E2E_PORT so runs on a shared PC do not collide with other projects.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  reporter: 'list',
  use: {
    viewport: { width: 1600, height: 900 },
    baseURL: `http://127.0.0.1:${port}`,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: `pnpm exec vite dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/NASA/neo3d.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
