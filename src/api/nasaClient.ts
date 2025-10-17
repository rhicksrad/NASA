export class HttpError extends Error {
  constructor(public status: number, public url: string, public body?: unknown) {
    super(`HTTP ${status} for ${url}`);
  }
}

type QueryValue = string | number | boolean;

const DEFAULT_API_BASE = import.meta.env.DEV ? '/api' : 'https://lively-haze-4b2c.hicksrch.workers.dev';
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) || DEFAULT_API_BASE).replace(/\/+$/, '');

function normalizeParams(params: Record<string, QueryValue>): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) entries[key] = String(value);
  return entries;
}

function buildUrl(path: string, params: Record<string, QueryValue> = {}): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const base = API_BASE ? `${API_BASE}${clean}` : clean;
  const url = new URL(base, window.location.href);
  const query = normalizeParams(params);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

export async function request<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  init?: RequestInit
): Promise<T> {
  const url = buildUrl(path, params);
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
  } catch (e) {
    console.error('[nasaClient] request failed', { path, url, params, err: e });
    throw e;
  } finally {
    clearTimeout(id);
  }
}
