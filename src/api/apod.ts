/** Astronomy Picture of the Day, proxied by the worker. */
import { fetchJson } from './worker';

export interface Apod {
  date: string;
  title: string;
  explanation: string;
  media_type: 'image' | 'video' | string;
  url?: string;
  hdurl?: string;
  /** Present for videos when the request asks for thumbnails. */
  thumbnail_url?: string;
  copyright?: string;
}

/**
 * APOD's upstream sometimes hangs rather than failing, so the wait is capped well below
 * the default: callers have another picture to show and should get to it promptly.
 */
export function fetchApod(signal?: AbortSignal): Promise<Apod> {
  return fetchJson<Apod>('/apod', { params: { thumbs: true }, signal, timeoutMs: 6000 });
}

/** A still image to show for the entry, or null when it has none (some videos). */
export function apodImageUrl(apod: Apod): string | null {
  const url = apod.media_type === 'image' ? apod.url : apod.thumbnail_url;
  return url && /^https?:\/\//.test(url) ? url.replace(/^http:/, 'https:') : null;
}
