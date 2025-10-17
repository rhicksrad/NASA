/* eslint-disable no-console */
import { parseSbdbOrbit } from './nasaClient';
import type { SbdbResponse } from '../types/sbdb';
import type { NeoBrowse } from '../types/nasa';
import { fromSbdb, jdFromDate, propagate, type Keplerian } from '../utils/orbit';

const BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';
const DAY_MS = 86_400_000;
const AU_IN_KM = 149_597_870.7;
const SECONDS_PER_DAY = 86_400;

type HorizonsElementsRecord = Record<string, unknown> & {
  a?: unknown;
  e?: unknown;
  i?: unknown;
  IN?: unknown;
  incl?: unknown;
  om?: unknown;
  OM?: unknown;
  node?: unknown;
  Omega?: unknown;
  w?: unknown;
  W?: unknown;
  peri?: unknown;
  M?: unknown;
  MA?: unknown;
  ma?: unknown;
  mean_anomaly?: unknown;
  epoch?: unknown;
  epoch_jd?: unknown;
  jd_tdb?: unknown;
};

export interface VectorSample {
  jd: number;
  posAU: [number, number, number];
  velAUPerDay: [number, number, number];
}

function toPath(path: string): string {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

async function wait(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function getJSON<T = unknown>(path: string): Promise<T> {
  const url = `${BASE}${toPath(path)}`;
  let attempt = 0;
  let lastError: unknown;
  while (attempt < 3) {
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!resp.ok) {
        const bodyText = await resp.text();
        throw { url, status: resp.status, bodyText };
      }
      const raw = await resp.text();
      try {
        return JSON.parse(raw) as T;
      } catch (error) {
        console.error('[neo3dData] Failed to parse JSON', { url, raw });
        throw error;
      }
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= 3) {
        break;
      }
      await wait(300 * attempt);
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

function formatUtc(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function wrapWithQuotes(value: string): string {
  const trimmed = value.trim();
  const bare = trimmed.replace(/^'+|'+$/g, '');
  const withSpace = bare.startsWith(' ') ? bare : ` ${bare}`;
  return `'${withSpace}'`;
}

function parseLineNumbers(line: string): number[] {
  const matches = Array.from(line.matchAll(/[-+]?\d+(?:\.\d+)?(?:E[-+]?\d+)?/gi));
  return matches.map(match => Number(match[0]));
}

function parseVectors(result: string): VectorSample[] {
  const start = result.indexOf('$$SOE');
  const end = result.indexOf('$$EOE');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Horizons VECTORS payload missing markers');
  }
  const body = result.slice(start + 5, end).trim();
  const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const samples: VectorSample[] = [];
  for (let i = 0; i < lines.length; i += 4) {
    const jdLine = lines[i];
    if (!jdLine) {
      continue;
    }
    const jdValue = Number(jdLine.split('=')[0].trim());
    const posLine = lines[i + 1];
    const velLine = lines[i + 2];
    if (!Number.isFinite(jdValue) || !posLine || !velLine) {
      continue;
    }
    const [x, y, z] = parseLineNumbers(posLine) as [number, number, number];
    const [vxRaw, vyRaw, vzRaw] = parseLineNumbers(velLine) as [number, number, number];
    const unitLine = lines[i + 3] ?? '';
    const hasAuUnits = /AU-?D/i.test(result) || /AU-?D/i.test(unitLine);
    const posAU: [number, number, number] = hasAuUnits
      ? [x, y, z]
      : [x / AU_IN_KM, y / AU_IN_KM, z / AU_IN_KM];
    const velAUPerDay: [number, number, number] = hasAuUnits
      ? [vxRaw, vyRaw, vzRaw]
      : [vxRaw * SECONDS_PER_DAY / AU_IN_KM, vyRaw * SECONDS_PER_DAY / AU_IN_KM, vzRaw * SECONDS_PER_DAY / AU_IN_KM];
    samples.push({ jd: jdValue, posAU, velAUPerDay });
  }
  if (!samples.length) {
    throw new Error('No Horizons vector samples parsed');
  }
  return samples;
}

function isoDay(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function toNumericValue(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return Number.NaN;
    }
    const parsed = Number(trimmed.replace(/[,\s]+/g, ''));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  if (value && typeof value === 'object') {
    const record = value as { value?: unknown };
    if ('value' in record) {
      return toNumericValue(record.value);
    }
  }
  return Number.NaN;
}

function readElement(record: HorizonsElementsRecord, keys: string[]): number {
  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }
    const raw = (record as Record<string, unknown>)[key];
    const value = toNumericValue(raw);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return Number.NaN;
}

export async function horizonsVectors(spk: string | number, times: Date[]): Promise<VectorSample[]> {
  if (!times.length) {
    return [];
  }
  const formatted = times.map(formatUtc).map(t => ` '${t}'`).join(',');
  const params = new URLSearchParams({
    COMMAND: ` ${String(spk)}`,
    EPHEM_TYPE: 'VECTORS',
    TLIST: formatted,
    OBJ_DATA: 'NO',
    format: 'json',
  });
  const data = await getJSON<{ result?: string }>(`/horizons?${params.toString()}`);
  if (typeof data?.result !== 'string') {
    throw new Error('Horizons VECTORS result missing');
  }
  return parseVectors(data.result);
}

export async function horizonsDailyVectors(spk: string | number, date: Date): Promise<VectorSample[]> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const nextDay = addDays(dayStart, 1);
  return horizonsVectors(spk, [dayStart, nextDay]);
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

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

export async function horizonsElements(command: string, date: Date): Promise<Keplerian> {
  const params = new URLSearchParams({
    COMMAND: wrapWithQuotes(command),
    EPHEM_TYPE: 'ELEMENTS',
    TLIST: wrapWithQuotes(formatUtc(date)),
    OBJ_DATA: 'NO',
    format: 'json',
  });
  const data = await getJSON<{ result?: string | { elements?: HorizonsElementsRecord[] }; elements?: HorizonsElementsRecord[] }>(
    `/horizons?${params.toString()}`,
  );

  const candidates: HorizonsElementsRecord[][] = [];
  if (data.result && typeof data.result === 'object' && 'elements' in data.result) {
    const fromResult = (data.result as { elements?: HorizonsElementsRecord[] }).elements;
    if (Array.isArray(fromResult) && fromResult.length) {
      candidates.push(fromResult);
    }
  }
  if (Array.isArray((data as { elements?: HorizonsElementsRecord[] }).elements)) {
    const fromRoot = (data as { elements: HorizonsElementsRecord[] }).elements;
    if (fromRoot.length) {
      candidates.push(fromRoot);
    }
  }

  for (const list of candidates) {
    const record = list[0];
    if (!record) {
      continue;
    }
    const e = readElement(record, ['e', 'ecc']);
    const a = readElement(record, ['a']);
    const iDeg = readElement(record, ['i', 'IN', 'incl']);
    const OmegaDeg = readElement(record, ['Omega', 'om', 'OM', 'node', 'longascnode']);
    const omegaDeg = readElement(record, ['omega', 'w', 'W', 'peri', 'arg_peri']);
    const MDeg = readElement(record, ['M', 'MA', 'ma', 'mean_anomaly']);
    const epochJD = readElement(record, ['epoch_jd', 'epoch', 'jd_tdb', 'jdref']);
    if (
      Number.isFinite(a) &&
      Number.isFinite(e) &&
      Number.isFinite(iDeg) &&
      Number.isFinite(OmegaDeg) &&
      Number.isFinite(omegaDeg) &&
      Number.isFinite(MDeg) &&
      Number.isFinite(epochJD)
    ) {
      return {
        a,
        e,
        i: degToRad(iDeg),
        Omega: degToRad(OmegaDeg),
        omega: degToRad(omegaDeg),
        M: degToRad(MDeg),
        epochJD,
      };
    }
  }

  const result = typeof data.result === 'string' ? data.result : undefined;
  if (typeof result !== 'string' || !result.includes('$$SOE')) {
    throw new Error('no elements');
  }
  const start = result.indexOf('$$SOE');
  const end = result.indexOf('$$EOE', start);
  const payload = result.slice(start + 5, end).trim();
  const lines = payload.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const block = lines.join(' ');
  const e = parseNumeric(block, 'EC');
  const a = parseNumeric(block, 'A');
  const i = degToRad(parseNumeric(block, 'IN'));
  const Omega = degToRad(parseNumeric(block, 'OM'));
  const omega = degToRad(parseNumeric(block, 'W'));
  const M = degToRad(parseNumeric(block, 'MA'));
  const epochJD = parseNumeric(block, 'JDCT');
  return { a, e, i, Omega, omega, M, epochJD };
}

export async function sbdbElements(s: string): Promise<{ name: string; els: Keplerian; raw: SbdbResponse }>{
  const path = `/sbdb?sstr=${encodeURIComponent(s)}&fullname=true`;
  const response = await getJSON<SbdbResponse>(path);
  const record = parseSbdbOrbit(response);
  const els = fromSbdb(record);
  const name = response.object?.fullname ?? response.object?.object_name ?? response.object?.des ?? s;
  return { name, els, raw: response };
}

export async function neoBrowse(params: { page?: number; size?: number } = {}): Promise<NeoBrowse> {
  const search = new URLSearchParams();
  if (params.page != null) search.set('page', String(params.page));
  if (params.size != null) search.set('size', String(params.size));
  if ([...search.keys()].length === 0) {
    search.set('size', '20');
  }
  return getJSON<NeoBrowse>(`/neo/browse?${search.toString()}`);
}

export interface Atlas3IResult {
  name: string;
  els: Keplerian;
  source: 'sbdb' | 'horizons';
  raw?: SbdbResponse;
}

export async function atlas3I(referenceDate: Date): Promise<Atlas3IResult> {
  const sbdbQueries = ['3I/2019 N2 (ATLAS)', '3I/ATLAS'];
  for (const query of sbdbQueries) {
    try {
      const primary = await sbdbElements(query);
      const pos = propagate(primary.els, jdFromDate(referenceDate));
      if (!pos.every(value => Number.isFinite(value))) {
        throw new Error('non-finite propagation');
      }
      return { name: primary.name, els: primary.els, source: 'sbdb', raw: primary.raw };
    } catch (error) {
      console.warn(`[neo3dData] SBDB lookup for ${query} failed`, error);
    }
  }

  const fallbackDate = new Date(referenceDate);
  const horizonsQueries = ['3I/2019 N2 (ATLAS)', '3I/ATLAS'];
  let lastError: unknown;
  for (const query of horizonsQueries) {
    try {
      const els = await horizonsElements(query, fallbackDate);
      const pos = propagate(els, jdFromDate(referenceDate));
      if (!pos.every(value => Number.isFinite(value))) {
        throw new Error('non-finite propagation');
      }
      return { name: query, els, source: 'horizons' };
    } catch (error) {
      lastError = error;
      console.warn(`[neo3dData] Horizons ELEMENTS lookup for ${query} failed`, error);
    }
  }

  throw (lastError ?? new Error('3I/ATLAS fallback failed'));
}

export const _internal = { parseVectors, isoDay, formatUtc };
