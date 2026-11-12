/** NeoWs catalogue of near-Earth objects, proxied by the worker. */
import type { NeoBrowse, NeoItem } from './neoTypes';
import { fetchJson, type RequestOptions } from './worker';

export type * from './neoTypes';

/** One page of the NEO catalogue (zero-based `page`, up to 20 objects per page upstream). */
export function getNeoBrowse(
  params: { page?: number; size?: number } = {},
  options: Pick<RequestOptions, 'signal' | 'timeoutMs'> = {},
): Promise<NeoBrowse> {
  return fetchJson<NeoBrowse>('/neo/browse', {
    ...options,
    params: { size: params.size ?? 20, page: params.page },
  });
}

export interface NeoFeed {
  element_count: number;
  /** Close approaches keyed by `YYYY-MM-DD`. */
  near_earth_objects: Record<string, NeoItem[]>;
}

/** Objects making a close approach to Earth between two dates (at most 7 days apart). */
export function getNeoFeed(startDate: string, endDate: string, signal?: AbortSignal): Promise<NeoFeed> {
  return fetchJson<NeoFeed>('/neo/feed', { params: { start_date: startDate, end_date: endDate }, signal });
}
