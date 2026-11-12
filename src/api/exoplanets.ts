/** NASA Exoplanet Archive TAP service, proxied by the worker. */
import { fetchJson } from './worker';

export type TapRow = Record<string, string | number | null>;

/** Runs an ADQL query and returns the result rows. */
export async function queryExoplanetArchive(adql: string, signal?: AbortSignal): Promise<TapRow[]> {
  const data = await fetchJson<TapRow[] | { data?: TapRow[]; rows?: TapRow[] }>('/exo/tap', {
    params: { adql },
    signal,
    timeoutMs: 45_000,
  });
  if (Array.isArray(data)) return data;
  return data?.data ?? data?.rows ?? [];
}
