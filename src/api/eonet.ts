/** EONET natural-event catalogue, proxied by the worker. */
import { fetchJson, fetchText } from './worker';

export interface EonetCategory {
  id: string;
  title: string;
}

export interface EonetGeometry {
  date?: string;
  type?: string;
  /** A [lon, lat] point, or polygon rings of such points. */
  coordinates?: unknown;
  /** Size or strength at this report: acres burned, wind in knots, and so on. */
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
}

export interface EonetEvent {
  id: string;
  title?: string;
  description?: string | null;
  /** When the event ended; null or missing while it is still under way. */
  closed?: string | null;
  categories?: EonetCategory[];
  sources?: Array<{ id?: string; url?: string }>;
  geometry?: EonetGeometry[];
}

export interface EonetQuery {
  status: string;
  start: string;
  end: string;
  category?: string;
  limit?: number;
}

export async function fetchEonetCategories(signal?: AbortSignal): Promise<EonetCategory[]> {
  const data = await fetchJson<{ categories?: EonetCategory[] }>('/eonet/categories', { signal });
  return (data.categories ?? []).filter((category) => category?.id);
}

export async function fetchEonetEvents(query: EonetQuery, signal?: AbortSignal): Promise<EonetEvent[]> {
  const data = await fetchJson<{ events?: EonetEvent[] }>('/eonet/events', {
    params: { limit: 500, ...query },
    signal,
  });
  return data.events ?? [];
}

export function fetchEonetEventMarkdown(id: string, signal?: AbortSignal): Promise<string> {
  return fetchText(`/event/${encodeURIComponent(id)}.md`, { signal, accept: 'text/markdown' });
}
