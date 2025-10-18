import { WORKER_BASE, HttpError } from './base';

const DEG2RAD = Math.PI / 180;

export type SbdbLookup = {
  signature?: unknown;
  object?: {
    fullname?: string;
    des?: string;
    prefix?: string;
    kind?: string;
    object_name?: string;
    orbit_class?: { code?: string; name?: string };
    pha?: boolean;
    neo?: boolean;
  };
  orbit?: {
    elements?: Array<{ name: string; label: string; value: string | number }>;
  };
  phys_par?: Array<{ name: string; value: string | number }>;
};

export type SbdbRow = {
  id: string;
  name: string;
  type: 'Asteroid' | 'Comet' | 'Other';
  H?: number;
  pv?: number;
  estDiameterKm?: number;
  e?: number;
  i?: number;
  q?: number;
  raw: SbdbLookup;
};

export type SbdbSuggestResult = { items: string[]; fallback: boolean };

type PersistentCache = {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
};

const lookupCache = new Map<string, SbdbLookup>();
const persistentCache = createPersistentCache();

function createPersistentCache(): PersistentCache {
  if (typeof window === 'undefined') {
    return { get: async () => undefined, set: async () => {} };
  }

  const fallback = createLocalStorageCache();

  if (!('indexedDB' in window)) {
    return fallback;
  }

  let dbPromise: Promise<IDBDatabase | null> | null = null;
  const openDb = (): Promise<IDBDatabase | null> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open('sbdb-cache', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('lookups')) {
            db.createObjectStore('lookups');
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  };

  return {
    async get(key) {
      const db = await openDb();
      if (!db) return fallback.get(key);
      return new Promise<unknown | undefined>((resolve) => {
        try {
          const tx = db.transaction('lookups', 'readonly');
          const store = tx.objectStore('lookups');
          const request = store.get(key);
          request.onsuccess = () => {
            resolve(request.result ?? undefined);
          };
          request.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      });
    },
    async set(key, value) {
      const db = await openDb();
      if (!db) {
        await fallback.set(key, value);
        return;
      }
      const ok = await new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction('lookups', 'readwrite');
          const store = tx.objectStore('lookups');
          let settled = false;
          const finish = (result: boolean) => {
            if (!settled) {
              settled = true;
              resolve(result);
            }
          };
          tx.oncomplete = () => finish(true);
          tx.onerror = () => finish(false);
          tx.onabort = () => finish(false);
          store.put(value, key);
        } catch {
          resolve(false);
        }
      });
      if (!ok) {
        await fallback.set(key, value);
      }
    },
  };
}

function createLocalStorageCache(): PersistentCache {
  const prefix = 'sbdb-cache:';
  if (typeof window === 'undefined') {
    return { get: async () => undefined, set: async () => {} };
  }
  return {
    async get(key) {
      try {
        const storage = window.localStorage;
        const raw = storage.getItem(prefix + key);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as { value?: unknown };
        return parsed.value;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      try {
        const storage = window.localStorage;
        const payload = JSON.stringify({ value });
        storage.setItem(prefix + key, payload);
      } catch {
        // ignore
      }
    },
  };
}

async function fetchJSON<T = unknown>(path: string): Promise<T> {
  const url = `${WORKER_BASE}${path}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(url, response.status, text);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(url, response.status, `Invalid JSON: ${text.slice(0, 200)}`);
  }
}

const buildSbdbKey = (query: string, fullPrec: boolean): string => {
  const params = new URLSearchParams({ sstr: query });
  if (fullPrec) {
    params.set('full-prec', '1');
  }
  return `/sbdb?${params.toString()}`;
};

async function getCachedLookup(key: string): Promise<SbdbLookup | null> {
  if (lookupCache.has(key)) {
    return lookupCache.get(key)!;
  }
  const cached = await persistentCache.get(key);
  if (cached && typeof cached === 'object') {
    const value = cached as SbdbLookup;
    lookupCache.set(key, value);
    return value;
  }
  return null;
}

async function cacheLookup(key: string, data: SbdbLookup): Promise<void> {
  lookupCache.set(key, data);
  await persistentCache.set(key, data);
}

const PERFECT_MATCH_SCORE = 10_000;
const GOOD_MATCH_THRESHOLD = 750;

const normalizeText = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toLowerCase();

const tokenizeText = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

const collectTokens = (value: string): Set<string> => new Set(tokenizeText(value));

const hasDigits = (token: string): boolean => /\d/.test(token);

const scoreNameCandidate = (
  name: string,
  queryNorm: string,
  variantNorm: string,
  queryTokens: Set<string>,
): { score: number; perfect: boolean; tokens: Set<string> } => {
  const trimmed = name.trim();
  if (!trimmed) {
    return { score: 0, perfect: false, tokens: new Set() };
  }

  const normalized = normalizeText(trimmed);
  const tokens = collectTokens(trimmed);

  if (normalized && normalized === queryNorm) {
    return { score: PERFECT_MATCH_SCORE, perfect: true, tokens };
  }

  let score = 0;
  if (normalized && normalized === variantNorm) {
    score += 700;
  }
  if (queryNorm && normalized.includes(queryNorm)) {
    score += 250;
  }
  if (queryNorm && queryNorm.includes(normalized) && normalized.length > 0) {
    score += 180;
  }

  let matched = 0;
  for (const token of queryTokens) {
    if (tokens.has(token)) {
      matched += 1;
      score += 200;
    }
  }

  if (matched === queryTokens.size && queryTokens.size > 0) {
    score += 400;
  } else if (matched > 0) {
    score += 120;
  }

  return { score, perfect: false, tokens };
};

const addAlias = (aliases: Set<string>, value: string | null | undefined) => {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (!trimmed) return;
  aliases.add(trimmed);
};

export function collectSbdbAliases(data: SbdbLookup): string[] {
  const aliases = new Set<string>();
  const object = data.object ?? {};
  addAlias(aliases, typeof object.des === 'string' ? object.des : undefined);
  if (typeof object.prefix === 'string' && typeof object.des === 'string') {
    addAlias(aliases, `${object.prefix.trim()} ${object.des.trim()}`);
  }
  addAlias(aliases, typeof object.object_name === 'string' ? object.object_name : undefined);
  addAlias(aliases, typeof object.fullname === 'string' ? object.fullname : undefined);
  if (typeof object.prefix === 'string' && typeof object.fullname === 'string') {
    addAlias(aliases, `${object.prefix.trim()} ${object.fullname.trim()}`);
  }
  addAlias(aliases, typeof object.prefix === 'string' ? object.prefix : undefined);
  return Array.from(aliases);
}

const evaluateLookupMatch = (query: string, variant: string, data: SbdbLookup): { score: number; perfect: boolean } => {
  const queryNorm = normalizeText(query);
  const variantNorm = normalizeText(variant);
  const queryTokens = collectTokens(query);
  const designators = Array.from(queryTokens).filter(hasDigits);

  const aliasSet = new Set(collectSbdbAliases(data));
  aliasSet.add(variant);

  const candidateTokens = new Set<string>();
  let bestScore = 0;
  let perfect = false;

  for (const name of aliasSet) {
    const { score, perfect: isPerfect, tokens } = scoreNameCandidate(name, queryNorm, variantNorm, queryTokens);
    for (const token of tokens) {
      candidateTokens.add(token);
    }
    if (isPerfect) {
      bestScore = PERFECT_MATCH_SCORE;
      perfect = true;
      break;
    }
    if (score > bestScore) {
      bestScore = score;
    }
  }

  if (!perfect) {
    if (designators.length > 0) {
      const hasAllDesignators = designators.every((token) => candidateTokens.has(token));
      if (hasAllDesignators) {
        bestScore += 200;
      } else {
        bestScore = Math.min(bestScore, 80);
      }
    }

    if (queryTokens.has('comet')) {
      const kind = (data.object?.kind || '').toLowerCase();
      if (kind.startsWith('c')) {
        bestScore += 180;
      } else if (kind.startsWith('a')) {
        bestScore -= 180;
      }
    }

    if (queryTokens.has('asteroid')) {
      const kind = (data.object?.kind || '').toLowerCase();
      if (kind.startsWith('a')) {
        bestScore += 160;
      } else if (kind.startsWith('c')) {
        bestScore -= 160;
      }
    }
  }

  return { score: bestScore, perfect };
};

const stripParenthetical = (value: string): string => value.replace(/\s*\([^)]*\)/g, ' ').replace(/\s{2,}/g, ' ').trim();

const extractMultiMatchCandidates = (body: string): string[] => {
  const queue: string[] = [body];
  const visited = new Set<string>();
  const out: string[] = [];

  while (queue.length > 0) {
    const next = queue.shift()!;
    if (visited.has(next)) continue;
    visited.add(next);

    try {
      const parsed = JSON.parse(next) as {
        list?: Array<{ name?: string; pdes?: string }>;
        body?: unknown;
      };

      if (Array.isArray(parsed.list)) {
        for (const entry of parsed.list) {
          if (entry && typeof entry.pdes === 'string') {
            out.push(entry.pdes);
          }
          if (entry && typeof entry.name === 'string') {
            out.push(entry.name);
          }
        }
      }

      const nested = parsed.body;
      if (typeof nested === 'string') {
        queue.push(nested);
      } else if (nested && typeof nested === 'object') {
        queue.push(JSON.stringify(nested));
      }
    } catch {
      // ignore parse errors and continue exploring other candidates
    }
  }

  return Array.from(new Set(out));
};

export async function sbdbLookup(sstr: string, opts: { fullPrec?: boolean } = {}): Promise<SbdbLookup> {
  const fullPrec = opts.fullPrec === true;
  const originalKey = buildSbdbKey(sstr, fullPrec);
  const directCached = await getCachedLookup(originalKey);
  type Candidate = { key: string; variant: string; data: SbdbLookup; score: number };
  let bestMatch: Candidate | null = null;

  const considerCandidate = async (variant: string, key: string, data: SbdbLookup): Promise<boolean> => {
    const evaluation = evaluateLookupMatch(sstr, variant, data);
    if (evaluation.perfect || evaluation.score >= GOOD_MATCH_THRESHOLD) {
      if (key !== originalKey) {
        await cacheLookup(originalKey, data);
      } else {
        lookupCache.set(originalKey, data);
        await persistentCache.set(originalKey, data);
      }
      bestMatch = { key, variant, data, score: evaluation.score };
      return true;
    }
    if (!bestMatch || evaluation.score > bestMatch.score) {
      bestMatch = { key, variant, data, score: evaluation.score };
    }
    return false;
  };

  if (directCached) {
    if (await considerCandidate(sstr, originalKey, directCached)) {
      return directCached;
    }
  }

  const queue: string[] = [];
  const seen = new Set<string>();
  const pushVariant = (value: string | null | undefined) => {
    const normalized = value?.trim();
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    queue.push(normalized);
  };

  pushVariant(sstr);
  const baseWithoutParens = stripParenthetical(sstr);
  pushVariant(baseWithoutParens);
  const tokens = baseWithoutParens.split(/\s+/).filter(Boolean);
  if (tokens.length > 0) {
    pushVariant(tokens[0]);
  }
  if (tokens.length > 1) {
    pushVariant(tokens.slice(0, 2).join(' '));
    pushVariant(tokens[tokens.length - 1]);
  }

  let lastError: unknown = null;

  while (queue.length > 0) {
    const variant = queue.shift()!;
    const key = buildSbdbKey(variant, fullPrec);

    const cached = await getCachedLookup(key);
    if (cached) {
      if (await considerCandidate(variant, key, cached)) {
        return cached;
      }
      continue;
    }

    try {
      const data = await fetchJSON<SbdbLookup>(key);
      if (key === originalKey) {
        lookupCache.set(key, data);
      } else {
        await cacheLookup(key, data);
      }
      if (await considerCandidate(variant, key, data)) {
        return data;
      }
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 300) {
          const candidates = extractMultiMatchCandidates(error.bodyText);
          for (const candidate of candidates) {
            pushVariant(candidate);
            pushVariant(stripParenthetical(candidate));
          }
          lastError = error;
          continue;
        }
        if (error.status >= 400 && error.status < 500) {
          lastError = error;
          continue;
        }
      }
      throw error;
    }
  }

  if (bestMatch) {
    if (bestMatch.key !== originalKey) {
      await cacheLookup(originalKey, bestMatch.data);
    } else {
      lookupCache.set(originalKey, bestMatch.data);
      await persistentCache.set(originalKey, bestMatch.data);
    }
    if (bestMatch.score > 0) {
      return bestMatch.data;
    }
  }

  if (lastError instanceof HttpError) {
    throw lastError;
  }
  throw new HttpError(originalKey, 404, `No SBDB match for ${sstr}`);
}

export async function sbdbSuggest(q: string): Promise<SbdbSuggestResult> {
  const url = `/sbdb?sstr=${encodeURIComponent(q)}&neo=1`;
  try {
    type SbdbSuggestItem = { fullname?: string; name?: string; sstr?: string };
    type SbdbSuggestPayload = { list?: SbdbSuggestItem[] };
    const data = await fetchJSON<SbdbSuggestPayload>(url);
    const list = Array.isArray(data.list) ? data.list : null;
    if (Array.isArray(list)) {
      const items = list
        .map((it) => it.fullname || it.name || it.sstr)
        .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
        .slice(0, 20);
      if (items.length > 0) {
        return { items, fallback: false };
      }
      return { items: [], fallback: false };
    }
  } catch {
    // ignore and fallback below
  }
  try {
    const one = await sbdbLookup(q, { fullPrec: true });
    const name = one?.object?.fullname || one?.object?.des;
    return name ? { items: [name], fallback: true } : { items: [], fallback: true };
  } catch {
    return { items: [], fallback: true };
  }
}

export function diameterFromH(H: number, pV = 0.14) {
  return (1329 / Math.sqrt(Math.max(0.01, pV))) * Math.pow(10, -H / 5);
}

export function normalizeRow(s: SbdbLookup, fallbackId: string): SbdbRow {
  const aliasCandidates = collectSbdbAliases(s);
  if (!aliasCandidates.includes(fallbackId)) {
    aliasCandidates.push(fallbackId);
  }
  const canonicalId =
    aliasCandidates.find((alias) => /\d/.test(alias)) ?? aliasCandidates[0] ?? fallbackId;
  const preferredName =
    (s?.object?.fullname && s.object.fullname.trim()) ||
    aliasCandidates.find((alias) => alias !== canonicalId) ||
    canonicalId;
  const name = preferredName;
  const kind = s?.object?.kind || '';
  const type = kind.startsWith('c') ? 'Comet' : kind.startsWith('a') ? 'Asteroid' : 'Other';

  const mapEl = new Map<string, number>();
  (s.orbit?.elements || []).forEach((el) => {
    const key = (el.name || el.label || '').toLowerCase();
    const value = Number(el.value);
    if (!Number.isNaN(value) && key) {
      mapEl.set(key, value);
    }
  });

  const phys = s.phys_par || [];
  const findPhys = (label: string) => phys.find((p) => p.name?.toLowerCase() === label)?.value;
  const Hraw = findPhys('h');
  const pvRaw = findPhys('albedo');
  const diameterRaw = phys.find((p) => /diam/i.test(p.name || ''))?.value;

  const H = Number(Hraw);
  const pv = Number(pvRaw);
  let estDiameterKm = Number(diameterRaw);
  if (!Number.isFinite(estDiameterKm) && Number.isFinite(H)) {
    const albedo = Number.isFinite(pv) ? pv : 0.14;
    estDiameterKm = diameterFromH(H, albedo);
  }

  return {
    id: canonicalId,
    name,
    type,
    H: Number.isFinite(H) ? H : undefined,
    pv: Number.isFinite(pv) ? pv : undefined,
    estDiameterKm: Number.isFinite(estDiameterKm) ? estDiameterKm : undefined,
    e: mapEl.get('e'),
    i: mapEl.get('i'),
    q: mapEl.get('q'),
    raw: s,
  };
}

export async function resolveMany(ids: string[]): Promise<SbdbRow[]> {
  const out: SbdbRow[] = [];
  for (const id of ids) {
    try {
      const data = await sbdbLookup(id, { fullPrec: true });
      out.push(normalizeRow(data, id));
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch {
      // skip failures
    }
  }
  return out;
}

export type ConicForProp = {
  q: number;
  e: number;
  i: number;
  Omega: number;
  omega: number;
  tp: number;
  a: number;
  epoch?: number;
  ma?: number;
};

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

export async function loadSBDBConic(
  sstr: string,
): Promise<{ conic: ConicForProp; label: string; row: SbdbRow | null; aliases: string[] }> {
  try {
    const data = await sbdbLookup(sstr, { fullPrec: true });
    const elems = data.orbit?.elements ?? [];
    const map = new Map<string, unknown>();
    for (const entry of elems) {
      if (entry?.name) {
        map.set(entry.name, entry.value);
      }
    }

    const e = toNum(map.get('e'));
    const q = toNum(map.get('q'));
    const i = toNum(map.get('i')) * DEG2RAD;
    const Om = toNum(map.get('om')) * DEG2RAD;
    const w = toNum(map.get('w')) * DEG2RAD;
    const tp = toNum(map.get('tp'));
    const epoch = toNum(map.get('epoch'));
    let ma = toNum(map.get('ma'));
    if (!Number.isFinite(ma)) {
      ma = toNum(map.get('M'));
    }
    const maRad = Number.isFinite(ma) ? (ma * DEG2RAD) : Number.NaN;
    let a = toNum(map.get('a'));

    if (!Number.isFinite(a) && Number.isFinite(q) && Number.isFinite(e)) {
      a = q / (1 - e);
    }

    if (![e, q, i, Om, w, tp, a].every(Number.isFinite)) {
      throw new Error('SBDB elements incomplete/invalid');
    }

    let row: SbdbRow | null = null;
    try {
      row = normalizeRow(data, sstr);
    } catch {
      row = null;
    }

    const aliasSet = new Set<string>(collectSbdbAliases(data));
    const pushAlias = (value: string | null | undefined) => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed) return;
      aliasSet.add(trimmed);
    };
    pushAlias(sstr);
    pushAlias(row?.id);
    pushAlias(row?.name);

    const label =
      row?.name || data.object?.fullname || data.object?.des || data.object?.object_name || sstr;
    pushAlias(label);

    return {
      conic: {
        e,
        q,
        i,
        Omega: Om,
        omega: w,
        tp,
        a,
        epoch: Number.isFinite(epoch) ? epoch : undefined,
        ma: Number.isFinite(maRad) ? maRad : undefined,
      },
      label,
      row,
      aliases: Array.from(aliasSet),
    };
  } catch (error) {
    if (error instanceof HttpError) {
      const body = error.bodyText ? `: ${error.bodyText}` : '';
      throw new Error(`SBDB ${error.status}${body}`);
    }
    throw error;
  }
}
