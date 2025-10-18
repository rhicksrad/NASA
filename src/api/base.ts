// src/api/base.ts
// Single source of truth for the worker origin (NEVER hardcode elsewhere).
export const WORKER_BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';

export class HttpError extends Error {
  constructor(public url: string, public status: number, public bodyText: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export async function getJSON<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'omit' });
  const text = await response.text();
  if (!response.ok) throw new HttpError(url, response.status, text);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(url, response.status, `Non-JSON: ${text.slice(0, 200)}`);
  }
}

export async function getTextOrJSON(path: string): Promise<string | unknown> {
  const absolute = /^https?:\/\//i.test(path)
    ? path
    : `${WORKER_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(absolute, { credentials: 'omit' });
  const text = await response.text();
  if (!response.ok) throw new HttpError(absolute, response.status, text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
