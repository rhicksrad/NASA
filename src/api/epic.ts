/* src/api/epic.ts */
import { WORKER_BASE, getTextOrJSON } from './base';
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

const EPIC_META_LATEST = '/epic/natural';
const EPIC_META_BY_DATE = (date: string) => `/epic/natural/date/${date}`;

const buildEpicArchivePath = (date: string, imageBase: string) => {
  // date is "YYYY-MM-DD HH:MM:SS" → split
  const [d] = date.split(' ');
  const [Y, M, D] = d.split('-');
  return `/epic/archive/natural/${Y}/${M}/${D}/png/${imageBase}.png`;
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
  const items = await getEpicJSON<EpicItem[]>(EPIC_META_BY_DATE(date));
  return { date, items: items.sort((a, b) => a.date.localeCompare(b.date)) };
}

export function buildEpicImageUrl(item: EpicItem): string {
  return `${WORKER_BASE}${buildEpicArchivePath(item.date, item.image)}`;
}

export function extractLatestDate(items: EpicItem[]): string | null {
  // items may span multiple days; choose max(date)
  const dates = Array.from(new Set(items.map(it => it.date.split(' ')[0])));
  if (!dates.length) return null;
  dates.sort(); // asc
  return dates[dates.length - 1];
}
