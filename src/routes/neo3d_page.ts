import '../styles/main.css';
import { getNeoBrowse } from '../api/fetch_neo';
import { jdFromDateUTC } from '../api/neo3dData';
import type { NextApproach } from '../lib/neo-client';
import type { NeoCloseApproach, NeoItem } from '../types/nasa';
import { initNeo3D } from './neo3d';

const NEO_FETCH = { pageSize: 50, limit: 500 } as const;

type CatalogOptions = {
  pageSize: number;
  limit: number;
  signal?: AbortSignal;
};

type NextApproachLite = NextApproach;

function parseApproachDate(entry: NeoCloseApproach): Date | null {
  if (typeof entry.epoch_date_close_approach === 'number' && Number.isFinite(entry.epoch_date_close_approach)) {
    return new Date(entry.epoch_date_close_approach);
  }
  const full = typeof entry.close_approach_date_full === 'string' ? entry.close_approach_date_full.trim() : '';
  if (full) {
    const normalized = `${full.replace(' ', 'T')}:00Z`;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const simple = typeof entry.close_approach_date === 'string' ? entry.close_approach_date.trim() : '';
  if (simple) {
    const parsed = new Date(`${simple}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function formatNumberString(value: unknown, digits: number): string | null {
  const asNumber = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(asNumber)) return null;
  return asNumber.toFixed(digits);
}

function deriveNextApproach(neo: NeoItem, refTime = Date.now()): NextApproachLite | null {
  const approaches = Array.isArray(neo.close_approach_data) ? neo.close_approach_data : [];
  if (!approaches.length) return null;

  const future = approaches
    .map((entry) => ({ entry, date: parseApproachDate(entry) }))
    .filter((item): item is { entry: NeoCloseApproach; date: Date } => item.date instanceof Date);

  if (!future.length) return null;

  future.sort((a, b) => a.date.getTime() - b.date.getTime());

  const nowThreshold = refTime - 6 * 60 * 60 * 1000; // allow slight look-back for near-present events
  const upcoming = future.find((item) => item.date.getTime() >= nowThreshold) ?? future[future.length - 1];

  const date = upcoming.date;
  const jd = jdFromDateUTC(date).toFixed(6);
  const formatted = upcoming.entry.close_approach_date_full
    ? upcoming.entry.close_approach_date_full
    : date.toISOString().slice(0, 16).replace('T', ' ');
  const distAu =
    formatNumberString(upcoming.entry.miss_distance?.astronomical, 6) ?? upcoming.entry.miss_distance?.astronomical ?? '—';
  const vRelKms =
    formatNumberString(upcoming.entry.relative_velocity?.kilometers_per_second, 3) ??
    upcoming.entry.relative_velocity?.kilometers_per_second ??
    '—';

  return { jd, date: formatted, distAu, vRelKms };
}

type CatalogLoader = (signal?: AbortSignal) => Promise<{ items: NeoItem[]; done: boolean }>;

function createNeoCatalogLoader({ pageSize, limit }: CatalogOptions): CatalogLoader {
  let nextPage = 0;
  let totalPages: number | null = null;
  let loaded = 0;

  return async (signal) => {
    if ((limit && loaded >= limit) || (totalPages != null && nextPage >= totalPages)) {
      return { items: [], done: true };
    }

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const data = await getNeoBrowse({ page: nextPage, size: pageSize }, { signal });
    const objects = data.near_earth_objects ?? [];
    const now = Date.now();
    const batch: NeoItem[] = [];
    for (const neo of objects) {
      if (limit && loaded >= limit) break;
      neo.next = deriveNextApproach(neo, now);
      batch.push(neo);
      loaded += 1;
    }

    const info = data.page;
    if (info) {
      if (typeof info.total_pages === 'number' && Number.isFinite(info.total_pages)) {
        totalPages = info.total_pages;
      }
      const reported = typeof info.number === 'number' ? info.number + 1 : nextPage + 1;
      nextPage = reported > nextPage ? reported : nextPage + 1;
    } else {
      nextPage += 1;
    }

    if (objects.length === 0) {
      return { items: batch, done: true };
    }

    const noMorePages = (limit && loaded >= limit) || (totalPages != null && nextPage >= totalPages);
    return { items: batch, done: noMorePages };
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.classList.add('neo3d-fullscreen');
  document.body.classList.add('neo3d-fullscreen');

  const host = document.getElementById('neo3d-host');
  if (!(host instanceof HTMLElement)) return;

  let neos: NeoItem[] = [];
  const loadCatalogPage = createNeoCatalogLoader({ ...NEO_FETCH });

  const loadMoreNeos = async () => {
    const { items, done } = await loadCatalogPage();
    if (items.length) {
      neos = neos.concat(items);
    }
    return { neos: items, done } as const;
  };

  const controller = await initNeo3D(() => neos, host, {
    loadMore: () => loadMoreNeos(),
  });

  try {
    const initial = await loadMoreNeos();
    controller?.setNeos(neos, { hasMore: !initial.done });
    const summary = document.getElementById('neo3d-neo-summary');
    if (summary && !controller) {
      summary.textContent = `Loaded ${neos.length} near-Earth objects.`;
    }
  } catch (error) {
    console.error('[neo3d] failed to load NEOs', error);
    controller?.setNeos([], { hasMore: false });
    const summary = document.getElementById('neo3d-neo-summary');
    if (summary) {
      summary.textContent = 'Failed to load NEO catalog. Reload the page to try again.';
    }
    const list = document.getElementById('neo3d-neo-list');
    if (list) {
      list.replaceChildren();
      const item = document.createElement('div');
      item.className = 'neo3d-empty';
      item.setAttribute('role', 'listitem');
      item.textContent = 'Failed to load NEO catalog. Reload the page to try again.';
      list.appendChild(item);
    }
  }
});
