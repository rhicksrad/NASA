/** Curated groups of notable small bodies offered as one-click additions. */
import rawCollections from './collections.json';

export interface SbdbCollection {
  id: string;
  title: string;
  items: string[];
}

interface CollectionsRecord {
  [title: string]: string[] | undefined;
}

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

/** Collections ship with the bundle; the promise keeps the call site uniform with the index loader. */
export function loadSbdbCollections(): Promise<SbdbCollection[]> {
  return Promise.resolve().then(() => parseCollections(rawCollections));
}
