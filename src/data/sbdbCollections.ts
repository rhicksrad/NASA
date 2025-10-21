import { HttpError } from '../api/base';

export interface SbdbCollection {
  id: string;
  title: string;
  items: string[];
}

interface CollectionsRecord {
  [title: string]: string[] | undefined;
}

const COLLECTIONS_URL = new URL('../assets/sbdb/collections.json', import.meta.url).href;

let cachedCollections: Promise<SbdbCollection[]> | null = null;

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function parseCollections(payload: unknown): SbdbCollection[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Invalid SBDB collections payload');
  }

  const record = payload as CollectionsRecord;
  const seen = new Set<string>();
  const collections: SbdbCollection[] = [];

  for (const [title, rawItems] of Object.entries(record)) {
    if (!rawItems || !Array.isArray(rawItems)) continue;
    const items: string[] = [];
    for (const raw of rawItems) {
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(trimmed);
      if (items.length === 25) break;
    }
    if (!items.length) continue;
    const id = slugify(title) || `collection-${collections.length + 1}`;
    collections.push({ id, title, items });
  }

  return collections;
}

export function loadSbdbCollections(): Promise<SbdbCollection[]> {
  if (!cachedCollections) {
    cachedCollections = fetch(COLLECTIONS_URL, { cache: 'force-cache' })
      .then((response) => {
        if (!response.ok) {
          throw new HttpError(COLLECTIONS_URL, response.status, 'Failed to load SBDB collections');
        }
        return response.json();
      })
      .then((payload) => parseCollections(payload))
      .catch((error) => {
        cachedCollections = null;
        throw error;
      });
  }
  return cachedCollections;
}
