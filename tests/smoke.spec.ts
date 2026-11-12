import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { installMockApi } from './support/mockApi';

/**
 * Every page of the site, rendered against offline fixtures.
 * Set SHOT_DIR to also write a screenshot per page (used for PR previews).
 */
const SHOT_DIR = process.env.SHOT_DIR;

interface PageCase {
  name: string;
  path: string;
  ready: (page: Page) => Promise<void>;
}

const PAGES: PageCase[] = [
  {
    name: 'home',
    path: '/NASA/',
    ready: async (page) => {
      await expect(page.locator('#hero-media.is-loaded img')).toBeVisible();
      await expect(page.locator('#hero-caption')).toContainText('Pillars in the Eagle Nebula');
      await expect(page.locator('#tile-neo [data-value]')).toHaveText('6');
      await expect(page.locator('#tile-events.is-ready')).toBeVisible();
      await expect(page.locator('#tile-cme.is-ready')).toBeVisible();
      await expect(page.locator('#iss-map .iss-map__dot')).toBeVisible();
      await expect(page.locator('#tile-iss [data-stat="alt"]')).toHaveText(/km/);
      await expect(page.locator('#earth-media.is-loaded img')).toBeVisible();
    },
  },
  {
    name: 'images-explorer',
    path: '/NASA/#/images/explorer',
    ready: async (page) => {
      await expect(page.locator('#page-host img').first()).toBeVisible();
    },
  },
  {
    name: 'epic',
    path: '/NASA/#/epic',
    ready: async (page) => {
      await expect(page.locator('#page-host img, #page-host canvas').first()).toBeVisible();
    },
  },
  {
    name: 'mars',
    path: '/NASA/#/mars',
    ready: async (page) => {
      await expect(page.locator('#page-host img').first()).toBeVisible();
    },
  },
  {
    name: 'about',
    path: '/NASA/#/about',
    ready: async (page) => {
      await expect(page.locator('#page-host')).toContainText(/about/i);
    },
  },
  {
    name: 'neo3d',
    path: '/NASA/neo3d.html',
    ready: async (page) => {
      await expect(page.locator('#neo3d-host canvas')).toBeVisible();
      await expect(page.locator('#neo3d-neo-list > *').first()).toBeVisible();
    },
  },
  {
    name: 'sat3d',
    path: '/NASA/sat3d.html',
    ready: async (page) => {
      await expect(page.locator('#canvas-holder canvas')).toBeVisible();
      await expect(page.locator('#info h2')).toContainText('ISS');
    },
  },
  {
    name: 'storm',
    path: '/NASA/storm.html?id=2024-05-10T16:36:00-CME-001',
    ready: async (page) => {
      await expect(page.locator('#md h1')).toBeVisible();
      await expect(page.locator('#md .timeline svg')).toBeVisible();
    },
  },
  {
    name: 'events',
    path: '/NASA/events.html',
    ready: async (page) => {
      await expect(page.locator('#list li').first()).toBeVisible();
      await expect(page.locator('#map .leaflet-interactive').first()).toBeVisible();
    },
  },
  {
    name: 'exo',
    path: '/NASA/exo.html',
    ready: async (page) => {
      await expect(page.locator('#rows tr').first()).toBeVisible();
      await expect(page.locator('#mrViz svg')).toBeVisible();
    },
  },
];

for (const { name, path, ready } of PAGES) {
  test(`${name} renders`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const api = await installMockApi(page);

    await page.goto(path);
    await ready(page);
    await page.waitForTimeout(1500);

    await expect(page.locator('.site-header')).toBeVisible();
    expect(pageErrors, 'uncaught page errors').toEqual([]);
    expect(api.unhandled, 'requests with no fixture').toEqual([]);

    if (SHOT_DIR) {
      mkdirSync(SHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage: true });
    }
  });
}
