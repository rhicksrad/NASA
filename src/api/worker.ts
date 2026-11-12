/**
 * The one place the browser talks to the backend.
 *
 * Every NASA/JPL dataset is proxied by a single Cloudflare Worker (see
 * `worker.js` at the repo root), so pages never call third-party APIs directly
 * and the NASA API key never reaches the client.
 */
export const WORKER_BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';

export class HttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly bodyText: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | readonly QueryValue[]>;

export interface RequestOptions {
  params?: QueryParams;
  signal?: AbortSignal;
  /** Abort the request after this many milliseconds (default 30s, 0 disables). */
  timeoutMs?: number;
  accept?: string;
}

/** Builds an absolute worker URL from a worker-relative path and query params. */
export function workerUrl(path: string, params: QueryParams = {}): URL {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, WORKER_BASE);
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (entry === null || entry === undefined || entry === '') continue;
      url.searchParams.append(key, String(entry));
    }
  }
  return url;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

const DEFAULT_TIMEOUT_MS = 30_000;

async function send(path: string, options: RequestOptions, defaultAccept: string): Promise<{ url: string; text: string }> {
  const { params, signal, timeoutMs = DEFAULT_TIMEOUT_MS, accept = defaultAccept } = options;
  const url = workerUrl(path, params).toString();

  const controller = new AbortController();
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : undefined;
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const response = await fetch(url, {
      headers: { Accept: accept },
      credentials: 'omit',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new HttpError(url, response.status, text);
    return { url, text };
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/** GET a worker route and parse the body as JSON. */
export async function fetchJson<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { url, text } = await send(path, options, 'application/json');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(url, 200, `Expected JSON, received: ${text.slice(0, 200)}`);
  }
}

/** GET a worker route and return the raw body (markdown reports, Horizons text). */
export async function fetchText(path: string, options: RequestOptions = {}): Promise<string> {
  const { text } = await send(path, options, 'text/plain, text/markdown, */*');
  return text;
}
