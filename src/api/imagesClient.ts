export interface NasaImagesItem {
  href: string;
  data: Array<{
    nasa_id: string;
    title?: string;
    description?: string;
    date_created?: string;
    keywords?: string[];
  }>;
  links?: Array<{ href: string; rel?: string; render?: string }>;
}

export interface ImagesSearchResult {
  items: NasaImagesItem[];
  total: number;
}

type SearchImagesParams = {
  q: string;
  page?: number;
  media_type?: string;
  year_start?: string | number;
  year_end?: string | number;
};

function buildEndpoint(): string {
  const base = (import.meta.env.VITE_WORKER_URL || '').replace(/\/+$/, '');
  if (!base) {
    return '/images/search';
  }
  return `${base}/images/search`;
}

function toSearchParams(params: SearchImagesParams): URLSearchParams {
  const search = new URLSearchParams();
  const page = params.page && Number.isFinite(params.page) ? Math.max(1, Math.floor(params.page)) : 1;
  search.set('page', String(page));
  search.set('q', params.q);
  search.set('media_type', params.media_type ?? 'image');
  if (params.year_start) {
    search.set('year_start', String(params.year_start));
  }
  if (params.year_end) {
    search.set('year_end', String(params.year_end));
  }
  return search;
}

function parseImagesResponse(json: unknown): ImagesSearchResult {
  if (!json || typeof json !== 'object' || !('collection' in json)) {
    return { items: [], total: 0 };
  }
  const collection = (json as { collection?: unknown }).collection;
  if (!collection || typeof collection !== 'object') {
    return { items: [], total: 0 };
  }
  const itemsRaw = (collection as { items?: unknown }).items;
  const totalRaw = (collection as { metadata?: { total_hits?: unknown } }).metadata?.total_hits;

  const items = Array.isArray(itemsRaw) ? (itemsRaw as NasaImagesItem[]) : [];
  const total = typeof totalRaw === 'number' && Number.isFinite(totalRaw) ? totalRaw : 0;
  return { items, total };
}

export async function searchImages(params: SearchImagesParams): Promise<ImagesSearchResult> {
  const endpoint = buildEndpoint();
  const searchParams = toSearchParams(params);
  const url = `${endpoint}?${searchParams.toString()}`;
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) {
    const err = new Error(`Images search failed with status ${response.status}`);
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }
  const json = await response.json();
  return parseImagesResponse(json);
}

export function bestThumb(item: NasaImagesItem): string | null {
  const preferred = item.links?.find(link => (link.render ?? '').toLowerCase() === 'image');
  if (preferred?.href) {
    return preferred.href;
  }
  const fallback = item.links?.[0]?.href ?? null;
  return fallback ?? null;
}
