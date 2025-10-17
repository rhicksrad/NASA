import { request } from './nasaClient';
import type { HorizonsJson } from '../types/horizons';
import type { Keplerian as OrbitKeplerian } from '../utils/orbit';

export type Keplerian = OrbitKeplerian;

export interface PlanetEl {
  name: string;
  color: number;
  els: Keplerian;
}

interface CacheRecord {
  key: string;
  timestamp: number;
  els: Keplerian;
}

const DEG2RAD = Math.PI / 180;
const CACHE_DB = 'horizons-cache';
const CACHE_STORE = 'elements';
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const PLANETS: Array<{ id: string; name: string; color: number }> = [
  { id: '199', name: 'Mercury', color: 0x9ca3af },
  { id: '299', name: 'Venus', color: 0xf59e0b },
  { id: '399', name: 'Earth', color: 0x64b5f6 },
  { id: '499', name: 'Mars', color: 0xef4444 },
  { id: '599', name: 'Jupiter', color: 0xfbbf24 },
  { id: '699', name: 'Saturn', color: 0xfde68a },
  { id: '799', name: 'Uranus', color: 0x60a5fa },
  { id: '899', name: 'Neptune', color: 0x93c5fd },
];

let dbPromise: Promise<IDBDatabase | null> | null = null;

function degToRad(value: number): number {
  return value * DEG2RAD;
}

function toIsoDay(isoTime: string): string {
  const [day] = isoTime.split('T');
  return day ?? isoTime;
}

async function openCache(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return null;
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const requestDb = window.indexedDB.open(CACHE_DB, CACHE_VERSION);
        requestDb.onupgradeneeded = () => {
          const db = requestDb.result;
          if (!db.objectStoreNames.contains(CACHE_STORE)) {
            db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
          }
        };
        requestDb.onerror = () => resolve(null);
        requestDb.onblocked = () => resolve(null);
        requestDb.onsuccess = () => resolve(requestDb.result);
      } catch (error) {
        console.warn('[horizons] indexedDB unavailable', error); // eslint-disable-line no-console
        resolve(null);
      }
    });
  }

  try {
    return await dbPromise;
  } catch (error) {
    console.warn('[horizons] indexedDB init failed', error); // eslint-disable-line no-console
    return null;
  }
}

async function readCache(key: string): Promise<Keplerian | null> {
  try {
    const db = await openCache();
    if (!db) {
      return null;
    }
    return await new Promise<Keplerian | null>((resolve) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const store = tx.objectStore(CACHE_STORE);
      const requestDb = store.get(key);
      requestDb.onerror = () => resolve(null);
      requestDb.onsuccess = () => {
        const record = requestDb.result as CacheRecord | undefined;
        if (!record) {
          resolve(null);
          return;
        }
        if (Date.now() - record.timestamp > CACHE_TTL_MS) {
          resolve(null);
          return;
        }
        resolve({ ...record.els });
      };
    });
  } catch (error) {
    console.warn('[horizons] cache read failed', error); // eslint-disable-line no-console
    return null;
  }
}

async function writeCache(key: string, els: Keplerian): Promise<void> {
  try {
    const db = await openCache();
    if (!db) {
      return;
    }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      const store = tx.objectStore(CACHE_STORE);
      const record: CacheRecord = { key, timestamp: Date.now(), els: { ...els } };
      const requestDb = store.put(record);
      requestDb.onerror = () => resolve();
      requestDb.onsuccess = () => resolve();
    });
  } catch (error) {
    console.warn('[horizons] cache write failed', error); // eslint-disable-line no-console
  }
}

function parseNumeric(result: string, token: string): number {
  const pattern = new RegExp(`${token}\\s*=\\s*([-+\\d.]+(?:E[-+]?\\d+)?)`, 'i');
  const match = pattern.exec(result);
  if (!match) {
    throw new Error(`Missing ${token}`);
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ${token}`);
  }
  return value;
}

function parseHorizonsResult(result: string): Keplerian {
  const e = parseNumeric(result, 'EC');
  const a = parseNumeric(result, 'A');
  const i = degToRad(parseNumeric(result, 'IN'));
  const Omega = degToRad(parseNumeric(result, 'OM'));
  const omega = degToRad(parseNumeric(result, 'W'));
  const M = degToRad(parseNumeric(result, 'MA'));
  const epochJD = parseNumeric(result, 'JDCT');

  return { a, e, i, Omega, omega, M, epochJD };
}

function roughPlanets(): Map<string, Keplerian> {
  const epochJD = 2451545.0;
  const entries: Array<[string, Keplerian]> = [
    ['199', { a: 0.38709927, e: 0.20563593, i: degToRad(7.00497902), Omega: degToRad(48.33076593), omega: degToRad(77.45779628), M: degToRad(252.2503235), epochJD }],
    ['299', { a: 0.72333566, e: 0.00677672, i: degToRad(3.39467605), Omega: degToRad(76.67984255), omega: degToRad(131.60246718), M: degToRad(181.9790995), epochJD }],
    ['399', { a: 1.00000261, e: 0.01671123, i: degToRad(0.00005), Omega: degToRad(-11.26064), omega: degToRad(102.94719), M: degToRad(100.46435), epochJD }],
    ['499', { a: 1.52371034, e: 0.0933941, i: degToRad(1.84969142), Omega: degToRad(49.55953891), omega: degToRad(336.04084), M: degToRad(355.45332), epochJD }],
    ['599', { a: 5.202887, e: 0.04838624, i: degToRad(1.30439695), Omega: degToRad(100.47390909), omega: degToRad(14.72847983), M: degToRad(34.39644051), epochJD }],
    ['699', { a: 9.53667594, e: 0.05386179, i: degToRad(2.48599187), Omega: degToRad(113.66242448), omega: degToRad(92.59887831), M: degToRad(49.95424423), epochJD }],
    ['799', { a: 19.18916464, e: 0.04725744, i: degToRad(0.77263783), Omega: degToRad(74.01692503), omega: degToRad(170.9542763), M: degToRad(313.23810451), epochJD }],
    ['899', { a: 30.06992276, e: 0.00859048, i: degToRad(1.77004347), Omega: degToRad(131.78422574), omega: degToRad(44.96476227), M: degToRad(304.88003), epochJD }],
  ];
  return new Map(entries);
}

export async function horizonsElements(command: string, isoTime: string): Promise<Keplerian> {
  const isoDay = toIsoDay(isoTime);
  const cacheKey = `${command}|${isoDay}`;
  const cached = await readCache(cacheKey);
  if (cached) {
    return cached;
  }

  const params = {
    COMMAND: `'${command}'`,
    EPHEM_TYPE: 'ELEMENTS',
    TIME: `'${isoTime}'`,
  } as const;

  const response = await request<HorizonsJson>('/horizons', params);
  if (response.error) {
    throw new Error(response.error);
  }
  if (typeof response.result !== 'string' || response.result.trim() === '') {
    throw new Error('Horizons result missing');
  }

  const els = parseHorizonsResult(response.result);
  await writeCache(cacheKey, els);
  return { ...els };
}

export async function fetchAllPlanetEls(isoTime: string): Promise<PlanetEl[]> {
  const rough = roughPlanets();
  const results: PlanetEl[] = [];

  for (const planet of PLANETS) {
    try {
      const els = await horizonsElements(planet.id, isoTime);
      results.push({ name: planet.name, color: planet.color, els });
    } catch (error) {
      const fallback = rough.get(planet.id);
      if (fallback) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[horizons] ${planet.id} ${message}`); // eslint-disable-line no-console
        results.push({ name: planet.name, color: planet.color, els: { ...fallback } });
      }
    }
  }

  return results;
}

export const _internal = {
  parseHorizonsResult,
  roughPlanets,
  toIsoDay,
};
