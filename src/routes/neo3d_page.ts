import '../styles/main.css';
import { getNeoBrowse } from '../api/fetch_neo';
import { jdFromDateUTC } from '../api/neo3dData';
import type { NextApproach } from '../lib/neo-client';
import type { NeoCloseApproach, NeoItem } from '../types/nasa';
import { initNeo3D } from './neo3d';

const NEO_FETCH = { pageSize: 100, maxPages: 5, limit: 250 } as const;

type CatalogOptions = {
  pageSize: number;
  maxPages: number;
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

async function fetchNeoCatalog({ pageSize, maxPages, limit, signal }: CatalogOptions): Promise<NeoItem[]> {
  const results: NeoItem[] = [];
  let page = 0;
  let totalPages = 1;

  while (page < totalPages && page < maxPages && results.length < limit) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const data = await getNeoBrowse({ page, size: pageSize }, { signal });
    const objects = data.near_earth_objects ?? [];
    const now = Date.now();
    for (const neo of objects) {
      if (results.length >= limit) break;
      neo.next = deriveNextApproach(neo, now);
      results.push(neo);
    }
    const info = data.page;
    totalPages = info?.total_pages ?? totalPages;
    page = (info?.number ?? page) + 1;
  }

  return results;
}

document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.classList.add('neo3d-fullscreen');
  document.body.classList.add('neo3d-fullscreen');

  const host = document.getElementById('neo3d-host');
  if (!(host instanceof HTMLElement)) return;

  let neos: NeoItem[] = [];
  const controller = await initNeo3D(() => neos, host);

  try {
    neos = await fetchNeoCatalog({ ...NEO_FETCH });
    controller?.setNeos(neos);
    const summary = document.getElementById('neo3d-neo-summary');
    if (summary && !controller) {
      summary.textContent = `Loaded ${neos.length} near-Earth objects.`;
    }
  } catch (error) {
    console.error('[neo3d] failed to load NEOs', error);
    controller?.setNeos([]);
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
