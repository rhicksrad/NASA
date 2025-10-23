import { mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import type { Vector3 } from 'three';

test('captures Wow! Signal overlay screenshot', async ({ page }) => {
  await page.goto('/NASA/neo3d.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#neo3d-host canvas');
  await page.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__wow) && Boolean(window.__neo3d));

  await page.evaluate(() => {
    const wow = window.__wow;
    const neo3d = window.__neo3d as Neo3DDebug;
    if (!wow || !neo3d) {
      throw new Error('Wow layer not ready');
    }
    wow.setVisible(true);
    const vectors = wow.getVectors();
    const center = vectors.A.clone().add(vectors.B).multiplyScalar(0.5);
    const distance = center.length() * 2.1;
    neo3d.focusOnWorld(center, { distance });
    neo3d.setPaused(true);
  });

  await page.waitForTimeout(2000);

  const outputDir = resolve('public/dev-shots');
  await mkdir(outputDir, { recursive: true });
  const screenshotPath = resolve(outputDir, 'wow.png');
  await page.screenshot({ path: screenshotPath });

  await expect(access(screenshotPath)).resolves.toBeUndefined();
});

declare global {
  interface Window {
    __neo3d?: Neo3DDebug;
    __wow?: WowDebugApi;
  }
}

interface WowDebugApi {
  setVisible: (visible: boolean) => void;
  getVectors: () => { A: Vector3; B: Vector3 };
}

interface Neo3DDebug {
  focusOnWorld(position: Vector3, options?: { distance?: number }): void;
  setPaused(paused: boolean): void;
}
