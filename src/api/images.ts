/** NASA Image and Video Library (images.nasa.gov), proxied by the worker. */
import { fetchJson, type RequestOptions } from './worker';

export interface NasaImageItem {
  nasa_id: string;
  title: string;
  description?: string;
  date_created?: string;
  photographer?: string;
  /** Preview-sized image, or an empty string when the record has none. */
  thumb: string;
}

export interface ImageSearchResult {
  items: NasaImageItem[];
  total: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ImageSearchParams {
  q: string;
  page?: number;
  year_start?: number | string;
  year_end?: number | string;
  keywords?: string[];
}

/** The library returns up to this many records per page. */
export const IMAGES_PAGE_SIZE = 100;

interface RawSearchResponse {
  collection?: {
    items?: Array<{
      data?: Array<Partial<Omit<NasaImageItem, 'thumb'>>>;
      links?: Array<{ href?: string; rel?: string; render?: string }>;
    }>;
    links?: Array<{ rel?: string; href?: string }>;
    metadata?: { total_hits?: number };
  };
}

interface RawAssetResponse {
  collection?: { items?: Array<{ href?: string }> };
}

const CACHE_PREFIX = 'imgx2:';
const CACHE_TTL_MS = 60 * 60 * 1000;

function readCache(key: string): ImageSearchResult | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { at: number; result: ImageSearchResult };
    if (Date.now() - entry.at < CACHE_TTL_MS) return entry.result;
    window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (private mode) or hold a stale shape; treat as a miss.
  }
  return null;
}

function writeCache(key: string, result: ImageSearchResult): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), result }));
  } catch {
    // Quota or privacy errors only cost us the cache.
  }
}

/** NASA still hands out http:// asset links; the site is served over https. */
function toHttps(url: string): string {
  return url.replace(/^http:\/\//i, 'https://');
}

function normalizeSearch(json: RawSearchResponse): ImageSearchResult {
  const collection = json?.collection ?? {};
  const items = (collection.items ?? []).map((item): NasaImageItem => {
    const data = item?.data?.[0] ?? {};
    const links = item?.links ?? [];
    const preview = links.find((link) => link.render === 'image' && link.href) ?? links[0];
    return {
      nasa_id: String(data.nasa_id ?? ''),
      title: String(data.title ?? 'Untitled'),
      description: data.description ? String(data.description) : undefined,
      date_created: data.date_created ? String(data.date_created) : undefined,
      photographer: data.photographer ? String(data.photographer) : undefined,
      thumb: preview?.href ? toHttps(String(preview.href)) : '',
    };
  });
  const rels = new Set((collection.links ?? []).map((link) => link.rel));
  const totalHits = Number(collection.metadata?.total_hits);
  return {
    items,
    total: Number.isFinite(totalHits) ? totalHits : items.length,
    hasNext: rels.has('next'),
    hasPrev: rels.has('prev'),
  };
}

export async function searchImages(
  params: ImageSearchParams,
  options: Pick<RequestOptions, 'signal'> = {},
): Promise<ImageSearchResult> {
  const query = {
    media_type: 'image',
    q: params.q,
    page: Math.max(1, Math.floor(params.page ?? 1)),
    year_start: params.year_start,
    year_end: params.year_end,
    keywords: (params.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean),
  };
  const cacheKey = CACHE_PREFIX + JSON.stringify(query);
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const json = await fetchJson<RawSearchResponse>('/images/search', { params: query, signal: options.signal });
  const result = normalizeSearch(json);
  writeCache(cacheKey, result);
  return result;
}

const ASSET_RANK = ['orig', 'large', 'medium', 'small', 'thumb'];

/** Picks the best rendition from an asset manifest: orig > large > medium > small > thumb. */
export function pickLargestAsset(hrefs: string[]): string | null {
  const images = hrefs.filter((href) => /\.(?:jpe?g|png|gif|webp)$/i.test(href));
  const rank = (href: string) => {
    const size = /~(\w+)\.\w+$/.exec(href)?.[1]?.toLowerCase() ?? '';
    const index = ASSET_RANK.indexOf(size);
    return index === -1 ? ASSET_RANK.length : index;
  };
  const best = [...images].sort((a, b) => rank(a) - rank(b))[0] ?? hrefs[0];
  return best ? toHttps(best) : null;
}

export async function largestAssetUrl(nasaId: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const json = await fetchJson<RawAssetResponse>(`/images/asset/${encodeURIComponent(nasaId)}`, { signal });
    const hrefs = (json?.collection?.items ?? []).map((item) => String(item.href ?? '')).filter(Boolean);
    return pickLargestAsset(hrefs);
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

export function imageDetailsUrl(nasaId: string): string {
  return `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`;
}
