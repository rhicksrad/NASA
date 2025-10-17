import type { NasaImageSearch, ImagePick } from '../types/nasa_images';
import { request } from './nasaClient';

// Find a usable thumbnail and a reasonable asset page link
function pickImage(res: NasaImageSearch): ImagePick | null {
  const items = res?.collection?.items ?? [];
  for (const it of items) {
    if (!it?.data?.length) continue;
    const d = it.data[0];
    if (d.media_type !== 'image') continue;

    // Prefer "preview" link if present
    const thumb =
      it.links?.find(l => (l.rel === 'preview' || l.render === 'image') && !!l.href)?.href ||
      it.links?.[0]?.href;

    if (thumb) {
      const assetPage =
        // recommended: nasa-images page if present in links, else omit
        it.href || undefined;
      return { thumbUrl: thumb, title: d.title || d.nasa_id, assetPage };
    }
  }
  return null;
}

export async function searchFirstImage(query: string): Promise<ImagePick | null> {
  // media_type=image to restrict
  const res = await request<NasaImageSearch>('/images/search', { q: query, media_type: 'image' });
  return pickImage(res);
}
