/* eslint-disable no-console */
import { parseSbdbOrbit } from './nasaClient';
import type { SbdbResponse } from '../types/sbdb';
import type { NeoBrowse } from '../types/nasa';
import { fromSbdb, jdFromDate, propagate, type Keplerian } from '../utils/orbit';

const BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';
const DAY_MS = 86_400_000;
const AU_IN_KM = 149_597_870.7;
const SECONDS_PER_DAY = 86_400;

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
    COMMAND: ` ${command}`,
    EPHEM_TYPE: 'ELEMENTS',
    TLIST: ` ${formatUtc(date)}`,
    OBJ_DATA: 'NO',
    format: 'json',
  });
  const data = await getJSON<{ result?: string }>(`/horizons?${params.toString()}`);
  const result = data.result;
  if (typeof result !== 'string' || !result.includes('$$SOE')) {
    throw new Error('Horizons ELEMENTS response missing ephemeris block');
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
  try {
    const primary = await sbdbElements('3I/ATLAS');
    const pos = propagate(primary.els, jdFromDate(referenceDate));
    const finite = pos.every(value => Number.isFinite(value));
    if (!finite) {
      throw new Error('3I/ATLAS SBDB propagation produced non-finite values');
    }
    return { name: primary.name, els: primary.els, source: 'sbdb', raw: primary.raw };
  } catch (error) {
    console.warn('[neo3dData] SBDB lookup for 3I/ATLAS failed', error);
  }

  const fallbackDate = new Date(referenceDate);
  const els = await horizonsElements('3I/ATLAS', fallbackDate);
  const pos = propagate(els, jdFromDate(referenceDate));
  const finite = pos.every(value => Number.isFinite(value));
  if (!finite) {
    throw new Error('3I/ATLAS fallback propagation failed');
  }
  return { name: '3I/ATLAS', els, source: 'horizons' };
}

export const _internal = { parseVectors, isoDay, formatUtc };
