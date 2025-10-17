export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body?: unknown
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export async function request<T>(
  path: string,
  params: Record<string, string | number> = {},
  init?: RequestInit
): Promise<T> {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 10_000);

  try {
    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: ctrl.signal,
      ...init
    });

    const ct = resp.headers.get('content-type') || '';
    const asJson = ct.includes('application/json');
    const data = asJson ? await resp.json() : await resp.text();

    if (!resp.ok) {
      throw new HttpError(resp.status, url.toString(), data);
    }
    return data as T;
  } finally {
    clearTimeout(id);
  }
}
