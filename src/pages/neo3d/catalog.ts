/** Paged loading of the NeoWs catalogue, annotated with each object's next close approach. */
import { getNeoBrowse, type NeoCloseApproach, type NeoItem, type NextApproach } from '../../api/neo';
import { jdFromDate } from '../../lib/julian';

export interface CatalogOptions {
  pageSize: number;
  /** Stop after this many objects in total. */
  limit: number;
}

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

export function deriveNextApproach(neo: NeoItem, refTime = Date.now()): NextApproach | null {
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
  const jd = jdFromDate(date).toFixed(6);
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

export type CatalogLoader = (signal?: AbortSignal) => Promise<{ items: NeoItem[]; done: boolean }>;

export function createNeoCatalogLoader({ pageSize, limit }: CatalogOptions): CatalogLoader {
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
