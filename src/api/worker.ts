/**
 * The one place the browser talks to the backend.
 *
 * Every NASA/JPL dataset is proxied by a single Cloudflare Worker (see
 * `worker.js` at the repo root), so pages never call third-party APIs directly
 * and the NASA API key never reaches the client.
 */
export const WORKER_BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';

/**
 * Where API calls go. On Cloudflare the Worker serves the site too, so the
 * build sets VITE_API_BASE=/api and requests stay on the page's own origin.
 * Anywhere else (GitHub Pages, local dev, tests) they go to the Worker's address.
 */
const API_BASE: string = import.meta.env.VITE_API_BASE || WORKER_BASE;

function apiUrl(path: string): URL {
  const rooted = path.startsWith('/') ? path : `/${path}`;
  if (/^https?:/.test(API_BASE)) return new URL(rooted, API_BASE);
  return new URL(`${API_BASE.replace(/\/$/, '')}${rooted}`, window.location.origin);
}

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
  /** Set false when the caller has its own fallback and should reach it quickly. */
  retry?: boolean;
}

/** Builds an absolute worker URL from a worker-relative path and query params. */
export function workerUrl(path: string, params: QueryParams = {}): URL {
  const url = apiUrl(path);
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

/**
 * Every call is a GET, so a failure that is likely to pass (the upstream hiccuped,
 * the rate limit window rolled, the connection dropped) is tried again before a
 * page has to show an error. The waits sit inside the request's own timeout.
 */
const RETRY_DELAYS_MS = [500, 1500];
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

async function send(path: string, options: RequestOptions, defaultAccept: string): Promise<{ url: string; text: string }> {
  const { params, signal, timeoutMs = DEFAULT_TIMEOUT_MS, accept = defaultAccept, retry = true } = options;
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
    for (let attempt = 0; ; attempt += 1) {
      const retryIn = retry && attempt < RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[attempt] : null;
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Accept: accept },
          credentials: 'omit',
          signal: controller.signal,
        });
      } catch (error) {
        // A dropped connection is worth another go; an abort or timeout is not.
        if (retryIn === null || controller.signal.aborted) throw error;
        await pause(retryIn, controller.signal);
        continue;
      }
      const text = await response.text();
      if (response.ok) return { url, text };
      if (retryIn === null || !RETRY_STATUSES.has(response.status)) throw new HttpError(url, response.status, text);
      await pause(retryIn, controller.signal);
    }
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
