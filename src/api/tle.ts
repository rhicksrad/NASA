/** Two-line element sets for Earth satellites, proxied by the worker. */
import { fetchJson } from './worker';

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

export function searchTLE(q: string, signal?: AbortSignal): Promise<TleSearchResponse> {
  const query = q.trim();
  if (!query) return Promise.resolve({ member: [] });
  return fetchJson<TleSearchResponse>('/tle/search', { params: { q: query }, signal });
}

export function getTLE(id: number, signal?: AbortSignal): Promise<TleApiMember> {
  return fetchJson<TleApiMember>(`/tle/${encodeURIComponent(id)}`, { signal });
}

/** Parses an API timestamp, falling back to "now" for missing or malformed values. */
function parseEpoch(value: string | undefined): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
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
      epoch: parseEpoch(entry.date),
    }));
}
