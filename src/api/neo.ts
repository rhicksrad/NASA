/** NeoWs catalogue of near-Earth objects, proxied by the worker. */
import type { NeoBrowse } from './neoTypes';
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
