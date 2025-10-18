/* src/api/epic.ts */
import { getTextOrJSON, HttpError } from './base';
export interface EpicItem {
  identifier: string; // e.g. "20241001123456"
  caption: string;
  image: string; // base name, e.g. "epic_1b_20241001012345"
  version?: string;
  date: string; // "YYYY-MM-DD HH:MM:SS"
  centroid_coordinates?: { lat: number; lon: number };
  coords?: unknown; // ignore for now
}

export interface EpicDay {
  date: string; // "YYYY-MM-DD"
  items: EpicItem[];
}

const EPIC_API_BASE = 'https://epic.gsfc.nasa.gov/api/natural';
const EPIC_META_LATEST = EPIC_API_BASE;
const EPIC_META_BY_DATE = (date: string) => `${EPIC_API_BASE}/date/${date}`;

// Build direct EPIC image URL (images are NOT on api.nasa.gov)
const EPIC_IMG_URL = (date: string, imageBase: string) => {
  // date is "YYYY-MM-DD HH:MM:SS"
  const [d] = date.split(' ');
  const [Y, M, D] = d.split('-');
  // Direct archive host (no API key needed; public CDN)
  return `https://epic.gsfc.nasa.gov/archive/natural/${Y}/${M}/${D}/png/${imageBase}.png`;
};

async function getEpicJSON<T>(path: string): Promise<T> {
  const payload = await getTextOrJSON(path);
  if (typeof payload === 'string') {
    throw new Error(`EPIC ${path} returned non-JSON payload`);
  }
  return payload as T;
}

export async function fetchEpicLatest(): Promise<EpicItem[]> {
  return getEpicJSON<EpicItem[]>(EPIC_META_LATEST);
}

export async function fetchEpicByDate(date: string): Promise<EpicDay> {
  try {
    const items = await getEpicJSON<EpicItem[]>(EPIC_META_BY_DATE(date));
    return { date, items: items.sort((a, b) => a.date.localeCompare(b.date)) };
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 503)) {
      return { date, items: [] };
    }
    throw err;
  }
}

export function buildEpicImageUrl(item: EpicItem): string {
  return EPIC_IMG_URL(item.date, item.image);
}

export function extractLatestDate(items: EpicItem[]): string | null {
  // items may span multiple days; choose max(date)
  const dates = Array.from(new Set(items.map(it => it.date.split(' ')[0])));
  if (!dates.length) return null;
  dates.sort(); // asc
  return dates[dates.length - 1];
}
