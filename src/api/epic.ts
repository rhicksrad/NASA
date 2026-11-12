/** DSCOVR EPIC "blue marble" imagery. */
import { fetchJson, HttpError } from './worker';

export interface EpicItem {
  identifier: string; // e.g. "20241001123456"
  caption: string;
  image: string; // base name, e.g. "epic_1b_20241001012345"
  version?: string;
  date: string; // "YYYY-MM-DD HH:MM:SS"
  centroid_coordinates?: { lat: number; lon: number };
}

export interface EpicDay {
  date: string; // "YYYY-MM-DD"
  items: EpicItem[];
}

const EPIC_ARCHIVE = 'https://epic.gsfc.nasa.gov';

/**
 * Metadata comes through the worker's `/epic/*` route (api.nasa.gov). That
 * mirror has a history of lagging behind or going dark, so a failed lookup
 * falls back to the EPIC team's own public API, which sends CORS headers.
 */
async function fetchEpicList(path: string, signal?: AbortSignal): Promise<EpicItem[]> {
  try {
    const items = await fetchJson<EpicItem[]>(`/epic/natural${path}`, { signal });
    if (Array.isArray(items)) return items;
    throw new Error('EPIC returned a non-list payload');
  } catch (error) {
    if (signal?.aborted) throw error;
    const url = `${EPIC_ARCHIVE}/api/natural${path}`;
    const response = await fetch(url, { credentials: 'omit', signal });
    if (!response.ok) throw new HttpError(url, response.status, await response.text());
    const items = (await response.json()) as EpicItem[];
    return Array.isArray(items) ? items : [];
  }
}

export function fetchEpicLatest(signal?: AbortSignal): Promise<EpicItem[]> {
  return fetchEpicList('', signal);
}

export async function fetchEpicByDate(date: string, signal?: AbortSignal): Promise<EpicDay> {
  try {
    const items = await fetchEpicList(`/date/${date}`, signal);
    return { date, items: items.sort((a, b) => a.date.localeCompare(b.date)) };
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 503)) {
      return { date, items: [] };
    }
    throw error;
  }
}

/**
 * Full-disc images live on the EPIC archive host; they are plain `<img>` loads, no API key.
 * `png` is the 2048px original, `jpg` a 1080px copy and `thumbs` a small preview.
 */
export function buildEpicImageUrl(item: EpicItem, variant: 'png' | 'jpg' | 'thumbs' = 'png'): string {
  const [year, month, day] = item.date.split(' ')[0].split('-');
  const extension = variant === 'png' ? 'png' : 'jpg';
  return `${EPIC_ARCHIVE}/archive/natural/${year}/${month}/${day}/${variant}/${item.image}.${extension}`;
}

/** Items may span several days; returns the most recent `YYYY-MM-DD`. */
export function extractLatestDate(items: EpicItem[]): string | null {
  const dates = items.map((item) => item.date.split(' ')[0]).sort();
  return dates.at(-1) ?? null;
}
