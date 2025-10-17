import type { Apod } from '../types/nasa';
import { request, _internal } from './nasaClient';

function utcYMD(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export async function getApodRobust(): Promise<Apod> {
  const today = new Date();
  const todayStr = utcYMD(today);
  const base = { thumbs: 'true' as const };

  try {
    return await _internal.withRetry(
      () => request<Apod>('/apod', { ...base, date: todayStr }, { timeoutMs: 60_000 }),
      2,
      800
    );
  } catch {
    const yesterday = new Date(today.getTime() - 86_400_000);
    const yStr = utcYMD(yesterday);
    return request<Apod>('/apod', { ...base, date: yStr }, { timeoutMs: 60_000 });
  }
}
