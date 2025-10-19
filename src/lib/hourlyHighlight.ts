import { imagesSearch, largestAssetUrl, type NasaImageItem } from '../api/nasaImages';

function ensureNotAborted(signal?: AbortSignal): void {
  if (!signal) return;
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted();
    return;
  }
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

const SEARCH_PRESETS = [
  'Apollo mission',
  'Artemis mission',
  'International Space Station',
  'James Webb Space Telescope',
  'Hubble Space Telescope',
  'Lunar Reconnaissance Orbiter',
];

const MAX_PAGES = 20;

export interface HourlyHighlight {
  item: NasaImageItem;
  assetUrl: string;
  query: string;
  page: number;
  timestamp: Date;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function safeAssetUrl(item: NasaImageItem, assetUrl: string | null): string {
  if (assetUrl && assetUrl.trim()) return assetUrl;
  if (item.thumb && item.thumb.trim()) return item.thumb;
  throw new Error('No usable asset URL for item');
}

async function selectFromQuery(
  query: string,
  seed: number,
  signal?: AbortSignal,
): Promise<{ item: NasaImageItem; page: number }> {
  ensureNotAborted(signal);
  const firstPage = await imagesSearch({ q: query, page: 1 }, { signal });
  if (!firstPage.items.length) {
    throw new Error('No items returned for query');
  }

  const perPage = Math.max(1, firstPage.items.length);
  const totalPages = Math.max(1, Math.min(MAX_PAGES, Math.ceil((firstPage.total || perPage) / perPage)));

  const pageSeed = hashString(`${seed}:${query}:page`);
  const targetPage = Math.min(totalPages, (pageSeed % totalPages) + 1);

  let pageResult = firstPage;
  if (targetPage !== 1) {
    try {
      ensureNotAborted(signal);
      const fetched = await imagesSearch({ q: query, page: targetPage }, { signal });
      if (fetched.items.length) {
        pageResult = fetched;
      }
    } catch {
      // Ignore and fall back to the first page.
    }
  }

  const itemSeed = hashString(`${seed}:${query}:item`);
  const index = pageResult.items.length ? itemSeed % pageResult.items.length : 0;
  return { item: pageResult.items[index], page: targetPage };
}

export async function getHourlyHighlight(now: Date = new Date(), signal?: AbortSignal): Promise<HourlyHighlight> {
  const timestamp = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
  const hourKey = `${timestamp.toISOString().slice(0, 13)}`;
  const baseSeed = hashString(hourKey);
  const presetOffset = baseSeed % SEARCH_PRESETS.length;

  for (let attempt = 0; attempt < SEARCH_PRESETS.length; attempt += 1) {
    const query = SEARCH_PRESETS[(presetOffset + attempt) % SEARCH_PRESETS.length];
    try {
      ensureNotAborted(signal);
      const { item, page } = await selectFromQuery(query, baseSeed + attempt * 1315423911, signal);
      ensureNotAborted(signal);
      const assetUrl = safeAssetUrl(item, await largestAssetUrl(item.nasa_id, signal));
      return { item, assetUrl, query, page, timestamp };
    } catch (err) {
      if (attempt === SEARCH_PRESETS.length - 1) {
        throw err instanceof Error ? err : new Error('Failed to load hourly highlight');
      }
    }
  }

  throw new Error('No hourly highlight available');
}
