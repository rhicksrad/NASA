export class HttpError extends Error {
  constructor(public status: number, public url: string, public body?: unknown) {
    super(`HTTP ${status} for ${url}`);
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

function buildUrl(path: string, params: Record<string, string | number> = {}): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const base = API_BASE ? `${API_BASE}${clean}` : clean;
  const url = new URL(base, window.location.href);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

export async function request<T>(
  path: string,
  params: Record<string, string | number> = {},
  init?: RequestInit
): Promise<T> {
  const url = buildUrl(path, params);
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 10_000);

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
