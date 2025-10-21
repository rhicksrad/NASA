import { WORKER_BASE, HttpError } from '../api/base';
import type { SbdbLookup } from '../api/sbdb';

export const SBDB_WORKER = WORKER_BASE;

export type SbdbTypeFilter = 'all' | 'ast' | 'com';

export type FieldName =
  | 'full_name'
  | 'pdes'
  | 'des'
  | 'neo'
  | 'kind'
  | 'H'
  | 'epoch_tdb'
  | 'diameter_km'
  | 'albedo'
  | 'G'
  | 'rot_per'
  | 'class';

export type SbdbFieldValue = string | number | boolean | null;

export interface SbdbSearchParams {
  q: string;
  limit: number;
  types: SbdbTypeFilter;
  fields: FieldName[];
}

export interface SbdbSearchResponse<F extends FieldName = FieldName> {
  signature?: unknown;
  fields: F[];
  count: number;
  data: Array<Record<F, SbdbFieldValue | undefined>>;
}

export interface SbdbSearchResult<F extends FieldName = FieldName> {
  response: SbdbSearchResponse<F>;
  upstreamQuery?: string | null;
}

export const DEFAULT_FIELDS: readonly FieldName[] = [
  'full_name',
  'pdes',
  'des',
  'neo',
  'kind',
  'H',
  'epoch_tdb',
];

export const ADVANCED_FIELDS: readonly FieldName[] = ['diameter_km', 'albedo', 'G', 'rot_per', 'class'];

export function buildSearchUrl({ q, limit, types, fields }: SbdbSearchParams): string {
  const params = new URLSearchParams();
  params.set('q', q);
  params.set('limit', Math.max(1, Math.min(1000, limit)).toString());
  params.set('types', types);
  if (fields.length) {
    params.set('fields', fields.join(','));
  }
  return `${SBDB_WORKER}/sbdb/search?${params.toString()}`;
}

export async function fetchSbdbSearch<F extends FieldName = FieldName>(
  signal: AbortSignal,
  params: SbdbSearchParams,
): Promise<SbdbSearchResult<F>> {
  const url = buildSearchUrl(params);
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });
  const upstreamQuery = response.headers.get('x-upstream-sbdbq');
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(url, response.status, text);
  }
  let parsed: SbdbSearchResponse<F>;
  try {
    parsed = JSON.parse(text) as SbdbSearchResponse<F>;
  } catch {
    throw new HttpError(url, response.status, `Invalid JSON: ${text.slice(0, 200)}`);
  }
  return { response: parsed, upstreamQuery };
}

export async function fetchSbdbDetail(signal: AbortSignal, identifier: string): Promise<SbdbLookup | string> {
  const params = new URLSearchParams({ sstr: identifier });
  const url = `${SBDB_WORKER}/sbdb?${params.toString()}`;
  const response = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(url, response.status, text);
  }
  try {
    return JSON.parse(text) as SbdbLookup;
  } catch {
    return text;
  }
}
