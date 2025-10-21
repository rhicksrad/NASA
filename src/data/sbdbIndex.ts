import type { SbdbTypeFilter } from '../utils/sbdb';

export interface SbdbIndexMetadata {
  asteroidCount: number;
  cometCount: number;
  source: string;
}

export interface SbdbAsteroidIndexEntry {
  type: 'ast';
  number: string | null;
  name: string | null;
  principal: string | null;
  other: string[];
  h: number | null;
  g: number | null;
  epoch: number | null;
  orbit: string | null;
  neo: boolean | null;
}

export interface SbdbCometIndexEntry {
  type: 'com';
  designation: string;
  name: string | null;
  packed: string | null;
  orbit: string | null;
  h: number | null;
  g: number | null;
}

export type SbdbIndexEntry = SbdbAsteroidIndexEntry | SbdbCometIndexEntry;

export interface SbdbIndexPayload {
  metadata: SbdbIndexMetadata;
  entries: SbdbIndexEntry[];
}

const INDEX_PATH = `${import.meta.env.BASE_URL}sbdb-index.json`;

let cachedIndex: Promise<SbdbIndexPayload> | null = null;

export function loadSbdbIndex(): Promise<SbdbIndexPayload> {
  if (!cachedIndex) {
    cachedIndex = fetch(INDEX_PATH, { cache: 'force-cache' })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load sbdb-index.json (HTTP ${response.status})`);
        }
        return response.json() as Promise<SbdbIndexPayload>;
      })
      .catch((error) => {
        cachedIndex = null;
        throw error;
      });
  }
  return cachedIndex;
}

function normaliseQuery(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-z]/g, '');
}

function tokensFromEntry(entry: SbdbIndexEntry): string[] {
  if (entry.type === 'ast') {
    const tokens: string[] = [];
    if (entry.number) tokens.push(entry.number);
    if (entry.name) tokens.push(entry.name);
    if (entry.principal) tokens.push(entry.principal);
    if (entry.other.length) tokens.push(...entry.other);
    return tokens;
  }
  const tokens: string[] = [entry.designation];
  if (entry.name) tokens.push(entry.name);
  if (entry.packed) tokens.push(entry.packed);
  return tokens;
}

export interface SbdbIndexSearchOptions {
  query: string;
  limit: number;
  types: SbdbTypeFilter;
}

export interface SbdbIndexSearchResult {
  items: SbdbIndexEntry[];
  total: number;
}

export function searchSbdbIndex(index: SbdbIndexPayload, options: SbdbIndexSearchOptions): SbdbIndexSearchResult {
  const trimmed = options.query.trim();
  if (!trimmed) {
    return { items: [], total: 0 };
  }
  const lower = trimmed.toLowerCase();
  const folded = normaliseQuery(trimmed);
  const wantAst = options.types === 'all' || options.types === 'ast';
  const wantCom = options.types === 'all' || options.types === 'com';
  const items: SbdbIndexEntry[] = [];
  let total = 0;
  for (const entry of index.entries) {
    if (entry.type === 'ast' && !wantAst) continue;
    if (entry.type === 'com' && !wantCom) continue;
    const tokens = tokensFromEntry(entry);
    let match = false;
    for (const token of tokens) {
      const lowered = token.toLowerCase();
      if (lowered.startsWith(lower)) {
        match = true;
        break;
      }
      if (folded && normaliseQuery(token).startsWith(folded)) {
        match = true;
        break;
      }
    }
    if (!match) continue;
    total += 1;
    if (items.length < options.limit) {
      items.push(entry);
    }
  }
  return { items, total };
}
