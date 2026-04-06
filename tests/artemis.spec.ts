import { mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('captures Artemis console screenshot', async ({ page }) => {
  await page.goto('/NASA/#/artemis', { waitUntil: 'networkidle' });
  await page.waitForSelector('#artemis-stage canvas', { timeout: 45_000 });
  await page.waitForSelector('.artemis-image-sidebar .artemis-gallery-card', { timeout: 45_000 });
  await page.waitForTimeout(1500);

  const outputDir = resolve('public/dev-shots');
  await mkdir(outputDir, { recursive: true });
  const screenshotPath = resolve(outputDir, 'artemis-console.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await expect(access(screenshotPath)).resolves.toBeUndefined();
});
