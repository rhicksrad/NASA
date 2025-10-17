/* eslint-disable no-console */
import { getJSON, parseSbdbOrbit } from './nasaClient';
import type { NeoBrowse } from '../types/nasa';
import type { SbdbResponse } from '../types/sbdb';
import { fromSbdb, jdFromDate, type Keplerian } from '../utils/orbit';

const DAY_MS = 86_400_000;

export interface VectorSample {
  jd: number;
  posAU: [number, number, number];
  velAUPerDay: [number, number, number];
}

const isFiniteVec = (v: readonly number[]): boolean => v.length === 3 && v.every(Number.isFinite);

function formatUtc(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function toUtcDate(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Invalid Horizons time input');
  }
  let normalized = trimmed;
  if (!normalized.includes('T') && normalized.includes(' ')) {
    normalized = normalized.replace(' ', 'T');
  }
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized = `${normalized}Z`;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid Horizons time input: ${value}`);
  }
  return parsed;
}

const toHorizonsTime = (iso: string) => formatUtc(toUtcDate(iso));

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function parseHorizonsVectors(resultText: string): {
  jd: number;
  posAU: [number, number, number];
  velAUPerDay: [number, number, number];
} {
  const body = resultText.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!body) {
    throw new Error('Horizons: missing $$SOE/$$EOE');
  }
  const lines = body
    .trim()
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  let jd = Number.NaN;
  for (const line of lines) {
    if (/^\d/.test(line)) {
      const token = line.split('=')[0].trim();
      const value = Number(token);
      if (Number.isFinite(value)) {
        jd = value;
        break;
      }
    }
  }

  const matches = Array.from(body.matchAll(/(V?[XYZ])\s*=\s*([+-]?\d+(?:\.\d+)?(?:E[+-]?\d+)?)/g));
  const values = new Map<string, number>();
  for (const [, key, raw] of matches) {
    const num = Number(raw);
    if (Number.isFinite(num)) {
      values.set(key.toUpperCase(), num);
    }
  }

  const pos = ['X', 'Y', 'Z'].map(label => values.get(label));
  const vel = ['VX', 'VY', 'VZ'].map(label => values.get(label));

  if (pos.some(v => v == null || !Number.isFinite(v)) || vel.some(v => v == null || !Number.isFinite(v))) {
    throw new Error('Horizons: non-finite vector data');
  }

  return {
    jd,
    posAU: pos as [number, number, number],
    velAUPerDay: vel as [number, number, number],
  };
}

export async function horizonsVectors(spk: string | number, when: Date | string): Promise<VectorSample> {
  const date = toUtcDate(when);
  const t = formatUtc(date);
  const url = `/horizons?COMMAND='${encodeURIComponent(String(spk))}'&EPHEM_TYPE=VECTORS&TLIST='${encodeURIComponent(t)}'&OBJ_DATA=NO&OUT_UNITS=AU-D&format=json`;
  const resp = await getJSON<{ result?: string } | string>(url);
  const text = typeof resp === 'string' ? resp : resp?.result ?? '';
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Horizons: empty VECTORS response');
  }
  const parsed = parseHorizonsVectors(text);
  const jd = Number.isFinite(parsed.jd) ? parsed.jd : jdFromDate(date);
  return { jd, posAU: parsed.posAU, velAUPerDay: parsed.velAUPerDay };
}

export async function horizonsDailyVectors(spk: string | number, date: Date): Promise<VectorSample[]> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const nextDay = addDays(dayStart, 1);
  const samples = await Promise.all([horizonsVectors(spk, dayStart), horizonsVectors(spk, nextDay)]);
  return samples.filter(sample => isFiniteVec(sample.posAU) && isFiniteVec(sample.velAUPerDay));
}

export async function loadAtlasSBDB(): Promise<Keplerian> {
  const response = await getJSON<SbdbResponse>('/sbdb?sstr=3I');
  const record = parseSbdbOrbit(response);
  const els = fromSbdb(record);
  const values = [els.a, els.e, els.i, els.Omega, els.omega, els.M, els.epochJD];
  if (!values.every(Number.isFinite) || !(els.a > 0) || els.e < 0 || els.e >= 1) {
    throw new Error('ATLAS: bad SBDB elements');
  }
  return els;
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

export const _internal = {
  formatUtc,
  toHorizonsTime,
  toUtcDate,
  parseHorizonsVectors,
};
