import '../styles/main.css';
import { getNeoBrowse } from '../api/fetch_neo';
import { fetchNeosViaWorker } from '../lib/neo-client';
import { initNeo3D } from './neo3d';
import type { NeoItem } from '../types/nasa';

const NEO_FETCH = { pageSize: 200, maxPages: 50, limit: 5000 } as const;

type CatalogOptions = {
  pageSize: number;
  maxPages: number;
  limit: number;
  signal?: AbortSignal;
  allowedIds?: Set<string>;
};

async function fetchNeoCatalog({ pageSize, maxPages, limit, signal, allowedIds }: CatalogOptions): Promise<NeoItem[]> {
  const results: NeoItem[] = [];
  const seen = new Set<string>();
  const target = Math.min(limit, allowedIds?.size ?? limit);
  let page = 0;
  let totalPages = 1;

  while (page < totalPages && page < maxPages && results.length < target) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const data = await getNeoBrowse({ page, size: pageSize }, { signal });
    const objects = data.near_earth_objects ?? [];
    for (const neo of objects) {
      if (allowedIds && !allowedIds.has(neo.id)) continue;
      if (seen.has(neo.id)) continue;
      seen.add(neo.id);
      results.push(neo);
      if (results.length >= target) break;
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
    const lite = await fetchNeosViaWorker({ ...NEO_FETCH });
    const ids = new Set(lite.map(item => item.id));
    const nextById = new Map(lite.map(item => [item.id, item.next ?? null]));
    const detailed = await fetchNeoCatalog({ ...NEO_FETCH, limit: ids.size || NEO_FETCH.limit, allowedIds: ids });
    for (const neo of detailed) {
      const next = nextById.has(neo.id) ? nextById.get(neo.id) ?? null : null;
      neo.next = next;
    }
    neos = detailed;
    controller?.setNeos(neos);
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
