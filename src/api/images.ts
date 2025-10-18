import { WORKER_BASE, getJSON } from './base';

export type MediaType = 'image' | 'video' | 'audio';

export type NasaImageItem = {
  data: Array<{
    nasa_id: string;
    title: string;
    description?: string;
    photographer?: string;
    secondary_creator?: string;
    center?: string;
    keywords?: string[];
    date_created?: string;
    media_type: MediaType;
  }>;
  links?: Array<{
    href: string;
    rel?: string;
    render?: string;
  }>;
  href: string;
};

export type NasaImageSearch = {
  collection: {
    version: string;
    href: string;
    items: NasaImageItem[];
    links?: Array<{ rel: string; prompt?: string; href: string }>;
    metadata?: { total_hits?: number };
  };
};

export type SearchParams = {
  q: string;
  media_type?: MediaType;
  year_start?: number;
  year_end?: number;
  center?: string;
  page?: number;
};

function encode(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  return search.toString();
}

export async function searchImages(params: SearchParams): Promise<NasaImageSearch> {
  const query = encode({
    q: params.q,
    media_type: params.media_type,
    year_start: params.year_start,
    year_end: params.year_end,
    center: params.center,
    page: params.page ?? 1,
  });
  const url = `${WORKER_BASE}/images/search?${query}`;
  return getJSON<NasaImageSearch>(url);
}

export type AssetManifestEntry = {
  href: string;
};

export async function fetchAssetManifest(hrefUrl: string): Promise<AssetManifestEntry[]> {
  return getJSON<AssetManifestEntry[]>(hrefUrl);
}

export function nextPageFrom(search: NasaImageSearch): number | null {
  const next = search.collection.links?.find(link => link.rel === 'next');
  if (!next?.href) return null;
  try {
    const url = new URL(next.href);
    const page = Number(url.searchParams.get('page') ?? '0');
    return Number.isFinite(page) && page > 0 ? page : null;
  } catch {
    return null;
  }
}
