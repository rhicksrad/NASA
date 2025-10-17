export class HttpError extends Error {
  constructor(public status: number, public url: string, public body?: unknown) {
    super(`HTTP ${status} for ${url}`);
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
const FALLBACK_BASE = 'https://api.nasa.gov';
const FALLBACK_API_KEY = (import.meta.env.VITE_NASA_API_KEY || '').trim() || 'DEMO_KEY';

function buildUrl(
  path: string,
  params: Record<string, string | number> = {},
  base: string = API_BASE
): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const resolvedBase = base.replace(/\/+$/, '');
  const full = resolvedBase ? `${resolvedBase}${clean}` : clean;
  const url = new URL(full, window.location.href);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

async function executeRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 30_000);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
      ...init,
    });

    const ct = resp.headers.get('content-type') || '';
    const asJson = ct.includes('application/json');
    const data = asJson ? await resp.json() : await resp.text();

    if (!resp.ok) throw new HttpError(resp.status, url, data);
    return data as T;
  } finally {
    clearTimeout(id);
  }
}

function shouldFallback(err: unknown): boolean {
  if (!API_BASE || API_BASE.includes('api.nasa.gov')) return false;
  if (err instanceof HttpError) {
    return [500, 502, 503, 504].includes(err.status);
  }
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return err instanceof TypeError;
}

export async function request<T>(
  path: string,
  params: Record<string, string | number> = {},
  init?: RequestInit
): Promise<T> {
  try {
    const primaryUrl = buildUrl(path, params);
    return await executeRequest<T>(primaryUrl, init);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[nasaClient] request failed', {
      path,
      url: buildUrl(path, params),
      params,
      err: e,
    });

    if (shouldFallback(e)) {
      const fallbackParams: Record<string, string | number> = { ...params };
      if (!('api_key' in fallbackParams)) fallbackParams.api_key = FALLBACK_API_KEY;
      const fallbackUrl = buildUrl(path, fallbackParams, FALLBACK_BASE);
      // eslint-disable-next-line no-console
      console.warn('[nasaClient] retrying via direct NASA API', {
        path,
        url: fallbackUrl,
      });

      try {
        return await executeRequest<T>(fallbackUrl, init);
      } catch (fallbackErr) {
        // eslint-disable-next-line no-console
        console.error('[nasaClient] fallback request failed', {
          path,
          url: fallbackUrl,
          params: fallbackParams,
          err: fallbackErr,
        });
        throw fallbackErr;
      }
    }

    throw e;
  }
}
