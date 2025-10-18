import { WORKER_BASE, HttpError } from './base';

function buildWorkerUrl(path: string): URL {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalized, WORKER_BASE);
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    // Access to trigger potential security exceptions (Safari private mode, etc.).
    window.sessionStorage.getItem('');
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export interface NasaImageItem {
  title: string;
  nasa_id: string;
  date_created?: string;
  photographer?: string;
  description?: string;
  thumb: string;
}

export interface SearchResult {
  items: NasaImageItem[];
  total: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export type SearchParams = {
  q: string;
  page?: number;
  year_start?: number;
  year_end?: number;
  keywords?: string[];
};

export function buildSearchUrl(p: SearchParams): URL {
  const url = buildWorkerUrl('/images/search');
  url.searchParams.set('media_type', 'image');
  url.searchParams.set('q', p.q);
  url.searchParams.set('page', String(p.page ?? 1));
  if (p.year_start) url.searchParams.set('year_start', String(p.year_start));
  if (p.year_end) url.searchParams.set('year_end', String(p.year_end));
  for (const raw of p.keywords ?? []) {
    const keyword = String(raw ?? '').trim();
    if (keyword) {
      url.searchParams.append('keywords', keyword);
    }
  }
  return url;
}

type RawSearchResponse = {
  collection?: {
    items?: Array<{
      data?: Array<{
        title?: string;
        nasa_id?: string;
        date_created?: string;
        photographer?: string;
        description?: string;
      }>;
      links?: Array<{ href?: string }>;
    }>;
    links?: Array<{ rel?: string; href?: string }>;
    metadata?: { total_hits?: number };
  };
};

export async function imagesSearch(p: SearchParams): Promise<SearchResult> {
  const url = buildSearchUrl(p);
  const key = `imgx:${url.search}`;
  const storage = getSessionStorage();
  if (storage) {
    const cached = storage.getItem(key);
    if (cached) {
      try {
        return JSON.parse(cached) as SearchResult;
      } catch {
        storage.removeItem(key);
      }
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });

  if (!response.ok) {
    const body = await response.text();
    throw new HttpError(url.toString(), response.status, body);
  }

  const json = (await response.json()) as RawSearchResponse;
  const collection = json?.collection ?? {};
  const items = (collection.items ?? []).map(item => {
    const data = item?.data?.[0] ?? {};
    const link = item?.links?.[0] ?? {};
    const result: NasaImageItem = {
      title: String(data.title ?? 'Untitled'),
      nasa_id: String(data.nasa_id ?? ''),
      date_created: data.date_created ? String(data.date_created) : undefined,
      photographer: data.photographer ? String(data.photographer) : undefined,
      description: data.description ? String(data.description) : undefined,
      thumb: String(link.href ?? ''),
    };
    return result;
  });

  const linkRels = new Map<string, string>((collection.links ?? []).map(link => [String(link.rel ?? ''), String(link.href ?? '')]));
  const result: SearchResult = {
    items,
    total: Number.isFinite(collection.metadata?.total_hits)
      ? Number(collection.metadata?.total_hits ?? items.length)
      : items.length,
    hasNext: linkRels.has('next'),
    hasPrev: linkRels.has('prev'),
  };

  if (storage) {
    try {
      storage.setItem(key, JSON.stringify(result));
    } catch {
      // Ignore storage quota errors.
    }
  }

  return result;
}

type RawAssetResponse = {
  collection?: { items?: Array<{ href?: string }> };
};

export async function largestAssetUrl(nasa_id: string): Promise<string | null> {
  const url = buildWorkerUrl(`/images/asset/${encodeURIComponent(nasa_id)}`);
  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });

  if (!response.ok) {
    return null;
  }

  const json = (await response.json()) as RawAssetResponse;
  const hrefs = (json?.collection?.items ?? []).map(item => String(item.href ?? '')).filter(Boolean);
  const ranked = hrefs.filter(href => /\.(?:jpe?g|png)$/i.test(href)).sort((a, b) => a.length - b.length);
  return ranked.pop() ?? hrefs[0] ?? null;
}
