/** Search and detail lookups against JPL's Small-Body Database (via the worker). */
import type { SbdbLookup } from './sbdb';
import { fetchJson } from './worker';

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

/** One search hit; only the requested fields are present. */
export type SbdbSearchRow<F extends FieldName = FieldName> = Partial<Record<F, SbdbFieldValue>>;

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
  data: Array<SbdbSearchRow<F>>;
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

/** Full-text search over the worker's small-body index. */
export function fetchSbdbSearch<F extends FieldName = FieldName>(
  signal: AbortSignal,
  { q, limit, types, fields }: SbdbSearchParams,
): Promise<SbdbSearchResponse<F>> {
  return fetchJson<SbdbSearchResponse<F>>('/sbdb/search', {
    signal,
    params: {
      q,
      limit: Math.max(1, Math.min(1000, limit)),
      types,
      fields: fields.length ? fields.join(',') : undefined,
    },
  });
}

/** Raw SBDB record for one object, exactly as JPL returns it. */
export function fetchSbdbDetail(signal: AbortSignal, identifier: string): Promise<SbdbLookup> {
  return fetchJson<SbdbLookup>('/sbdb', { signal, params: { sstr: identifier } });
}
