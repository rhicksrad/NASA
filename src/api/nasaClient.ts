// Central client that always talks to the Cloudflare Worker proxy.
// Never attach api_key here; the Worker adds it.
// Keep timeouts strict and surface upstream HTTP codes.

const BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';

export class HttpError extends Error {
  constructor(public status: number, public url: string, public body?: any) {
    super(`HTTP ${status} for ${url}`);
  }
}

export async function request<T = any>(
  path: string,
  params: Record<string, string | number | boolean> = {},
  timeoutMs = 15000
): Promise<T> {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });

    const ct = res.headers.get('content-type') || '';
    const text = await res.text();

    if (!res.ok) {
      throw new HttpError(res.status, url.toString(), text);
    }
    if (ct.includes('application/json')) return JSON.parse(text) as T;
    return text as unknown as T;
  } catch (err) {
    // Normalize AbortError for clearer logs
    if ((err as any)?.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function wait(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 0, delayMs = 0): Promise<T> {
  let attempt = 0;
  const maxAttempts = Math.max(0, Math.floor(retries)) + 1;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= maxAttempts) {
        break;
      }
      if (delayMs > 0) {
        await wait(delayMs);
      }
    }
  }

  throw lastError;
}

export const _internal = {
  withRetry,
};
