import type { SbdbOrbit, SbdbResponse } from '../types/sbdb';
import type { SbdbOrbitRecord } from '../utils/orbit';

export class HttpError extends Error {
  constructor(public status: number, public url: string, public body?: unknown) {
    super(`HTTP ${status} for ${url}`);
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

type RequestParams = Record<string, string | number>;

type RequestOptions = RequestInit & { timeoutMs?: number };

function buildUrl(path: string, params: RequestParams = {}): string {
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    return url.toString();
  }

  const clean = path.startsWith('/') ? path : `/${path}`;
  const full = API_BASE ? `${API_BASE}${clean}` : clean;
  const url = new URL(full, window.location.href);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

function createTimeoutSignal(timeoutMs: number) {
  let timedOut = false;
  const abortSignalCtor = AbortSignal as typeof AbortSignal & { timeout?: (ms: number) => AbortSignal };

  if (typeof abortSignalCtor?.timeout === 'function') {
    const signal = abortSignalCtor.timeout(timeoutMs);
    const onAbort = () => {
      timedOut = true;
    };
    signal.addEventListener('abort', onAbort, { once: true });
    return {
      signal,
      cleanup: () => signal.removeEventListener('abort', onAbort),
      didTimeout: () => timedOut,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
    didTimeout: () => timedOut,
  };
}

function mergeAbortSignals(signals: AbortSignal[]): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const unlisteners: Array<() => void> = [];

  const cleanup = () => {
    while (unlisteners.length) {
      const off = unlisteners.pop();
      if (off) off();
    }
  };

  const abortFrom = (signal: AbortSignal) => {
    if (controller.signal.aborted) return;
    cleanup();
    const reason = (signal as { reason?: unknown }).reason;
    controller.abort(reason);
  };

  for (const signal of signals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const handler = () => abortFrom(signal);
    signal.addEventListener('abort', handler, { once: true });
    unlisteners.push(() => signal.removeEventListener('abort', handler));
  }

  return { signal: controller.signal, cleanup };
}

function isAbortError(error: unknown): error is DOMException | Error {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  return error instanceof Error && error.name === 'AbortError';
}

function sbdbValueFromOrbit(orbit: SbdbOrbit, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = (orbit as Record<string, unknown>)[key];
    if (typeof direct === 'string' && direct.trim() !== '') {
      return direct;
    }
  }

  const { elements } = orbit;
  if (Array.isArray(elements)) {
    for (const key of keys) {
      const found = elements.find(el => el.name === key || el.label === key);
      if (!found) {
        continue;
      }
      const value = found.value;
      if (value == null) {
        continue;
      }
      const asString = typeof value === 'string' ? value : String(value);
      if (asString.trim() !== '') {
        return asString;
      }
    }
  }

  return undefined;
}

export function ensureSbdbOrbit(response: SbdbResponse): SbdbOrbit {
  if (!response.orbit) {
    throw new Error('No SBDB orbit');
  }
  return response.orbit;
}

export function parseSbdbOrbit(response: SbdbResponse): SbdbOrbitRecord {
  const orbit = ensureSbdbOrbit(response);
  const epochRaw = typeof orbit.epoch === 'string' && orbit.epoch.trim() !== '' ? orbit.epoch : undefined;
  const epochFallback = typeof orbit.cov_epoch === 'string' && orbit.cov_epoch.trim() !== '' ? orbit.cov_epoch : undefined;
  const epoch = epochRaw ?? epochFallback;
  const e = sbdbValueFromOrbit(orbit, ['e']);
  const i = sbdbValueFromOrbit(orbit, ['i']);
  const om = sbdbValueFromOrbit(orbit, ['om', 'node']);
  const w = sbdbValueFromOrbit(orbit, ['w', 'peri']);

  if (!epoch || !e || !i || !om || !w) {
    throw new Error('Incomplete SBDB orbit');
  }

  const record: SbdbOrbitRecord = { e, i, om, w, epoch };

  const a = sbdbValueFromOrbit(orbit, ['a']);
  if (a) {
    record.a = a;
  }

  const q = sbdbValueFromOrbit(orbit, ['q']);
  if (q) {
    record.q = q;
  }

  const ma = sbdbValueFromOrbit(orbit, ['ma', 'M']);
  if (ma) {
    record.ma = ma;
  }

  const M = sbdbValueFromOrbit(orbit, ['M', 'ma']);
  if (M) {
    record.M = M;
  }

  return record;
}

export async function request<T>(
  path: string,
  params: RequestParams = {},
  init?: RequestOptions
): Promise<T> {
  const url = buildUrl(path, params);
  const { timeoutMs = 30_000, signal: externalSignal, headers: initHeaders, ...restInit } = init ?? {};

  const cleanups: Array<() => void> = [];
  const signals: AbortSignal[] = [];
  let didTimeout = () => false;

  if (timeoutMs > 0) {
    const timeout = createTimeoutSignal(timeoutMs);
    signals.push(timeout.signal);
    cleanups.push(timeout.cleanup);
    didTimeout = timeout.didTimeout;
  }

  if (externalSignal) {
    signals.push(externalSignal);
  }

  let signal: AbortSignal | undefined;
  if (signals.length === 1) {
    signal = signals[0];
  } else if (signals.length > 1) {
    const merged = mergeAbortSignals(signals);
    signal = merged.signal;
    cleanups.push(merged.cleanup);
  }

  const headers = new Headers(initHeaders);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const requestInit: RequestInit = { ...restInit, headers, signal };
  if (!requestInit.method) {
    requestInit.method = 'GET';
  }

  try {
    const resp = await fetch(url, requestInit);

    const ct = resp.headers.get('content-type') || '';
    const asJson = ct.includes('application/json');
    const data = asJson ? await resp.json() : await resp.text();

    if (!resp.ok) throw new HttpError(resp.status, url, data);
    return data as T;
  } catch (error) {
    let finalError: unknown = error;
    if (isAbortError(error) && didTimeout()) {
      const timeoutError = new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      finalError = timeoutError;
    }
    console.error('[nasaClient] request failed', { path, url, params, err: finalError });
    throw finalError;
  } finally {
    for (const cleanup of cleanups) cleanup();
  }
}

async function wait(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 0,
  delayMs = 0
): Promise<T> {
  let attempt = 0;
  // Ensure retries is a non-negative integer
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
