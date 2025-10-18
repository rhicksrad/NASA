// src/api/base.ts
// Single source of truth for the worker origin (NEVER hardcode elsewhere).
export const WORKER_BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';

// Small helper for GET text/JSON with friendly error surface.
export class HttpError extends Error {
  constructor(public url: string, public status: number, public bodyText: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export async function getTextOrJSON(path: string): Promise<string | unknown> {
  const url = `${WORKER_BASE}${path}`;
  const r = await fetch(url, { credentials: 'omit' });
  const t = await r.text();
  if (!r.ok) throw new HttpError(url, r.status, t);
  try { return JSON.parse(t); } catch { return t; }
}
