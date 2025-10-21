import { HttpError, WORKER_BASE } from './api/base';

export interface TleApiMember {
  satelliteId: number;
  name: string;
  line1: string;
  line2: string;
  date: string;
  ['@id']?: string;
  ['@type']?: string;
}

export interface TleSearchResponse {
  member: TleApiMember[];
}

export interface NormalizedTle {
  id: number;
  name: string;
  line1: string;
  line2: string;
  epoch: Date;
}

const SEARCH_ENDPOINT = '/tle/search';
const SINGLE_ENDPOINT = '/tle';

function buildUrl(path: string, query?: Record<string, string>): string {
  const url = new URL(path, WORKER_BASE);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'omit', signal });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`TLE ${response.status}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new HttpError(url, response.status, text);
  }
}

export async function searchTLE(q: string, signal?: AbortSignal): Promise<TleSearchResponse> {
  const trimmed = q.trim();
  if (!trimmed) {
    return { member: [] };
  }
  const url = buildUrl(SEARCH_ENDPOINT, { q: trimmed });
  return fetchJson<TleSearchResponse>(url, signal);
}

export async function getTLE(id: number, signal?: AbortSignal): Promise<TleApiMember> {
  const url = buildUrl(`${SINGLE_ENDPOINT}/${encodeURIComponent(id)}`);
  return fetchJson<TleApiMember>(url, signal);
}

export function parseTLEList(json: { member?: TleApiMember[] } | null | undefined): NormalizedTle[] {
  if (!json || !Array.isArray(json.member)) {
    return [];
  }
  return json.member
    .filter((entry): entry is TleApiMember =>
      !!entry && typeof entry.satelliteId === 'number' && typeof entry.line1 === 'string' && typeof entry.line2 === 'string'
    )
    .map((entry) => ({
      id: entry.satelliteId,
      name: entry.name ?? `NORAD ${entry.satelliteId}`,
      line1: entry.line1.trim(),
      line2: entry.line2.trim(),
      epoch: new Date(entry.date ?? Date.now()),
    }));
}
