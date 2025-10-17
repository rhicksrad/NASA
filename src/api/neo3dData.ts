/* eslint-disable no-console */
import { getJSON } from './nasaClient';
import type { NeoBrowse } from '../types/nasa';
import { jdFromDate, type Keplerian } from '../utils/orbit';

const DAY_MS = 86_400_000;
const DEG2RAD = Math.PI / 180;

export interface VectorSample {
  jd: number;
  posAU: [number, number, number];
  velAUPerDay: [number, number, number];
}

const isFinite3 = (v: readonly number[]): boolean => v.length === 3 && v.every(Number.isFinite);

const normTime = (iso: string): string => iso.replace('T', ' ').replace(/Z$/i, '');

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

const toIsoSecond = (input: Date | string): string => {
  if (input instanceof Date) {
    return input.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Horizons: invalid time input');
  const hasTime = trimmed.includes('T') || trimmed.includes(' ');
  const withT = hasTime ? trimmed.replace(' ', 'T') : `${trimmed}T00:00:00Z`;
  const hasZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(withT);
  const normalized = hasZone ? withT : `${withT}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Horizons: invalid time input ${input}`);
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

export function parseHorizonsVectors(resultText: string): {
  jd: number;
  posAU: [number, number, number];
  velAUPerDay: [number, number, number];
} {
  const block = resultText.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!block) throw new Error('Horizons: missing SOE/EOE');
  const lines = block
    .trim()
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const jdLine = lines.find(line => /^\d/.test(line)) ?? '';
  const jd = Number(jdLine.split(/[\s=]+/)[0]);

  const xyzLine = lines.find(line => line.startsWith('X ='));
  const vLine = lines.find(line => line.startsWith('VX='));
  if (!xyzLine || !vLine) throw new Error('Horizons: missing vector lines');

  const num = (value: string) => Number(value.replace(/[^0-9+-.Ee]/g, ''));
  const posMatches = [...xyzLine.matchAll(/[XYZ]\s*=\s*([+-]?\d\.\d+E[+-]\d+)/g)].map(match => num(match[1]));
  const velMatches = [...vLine.matchAll(/V[XYZ]\s*=\s*([+-]?\d\.\d+E[+-]\d+)/g)].map(match => num(match[1]));

  if (posMatches.length !== 3 || velMatches.length !== 3) throw new Error('Horizons: non-finite');
  if (![...posMatches, ...velMatches].every(Number.isFinite)) throw new Error('Horizons: non-finite');

  return {
    jd,
    posAU: posMatches as [number, number, number],
    velAUPerDay: velMatches as [number, number, number],
  };
}

export async function horizonsVectors(command: string | number, when: Date | string): Promise<VectorSample> {
  const iso = toIsoSecond(when);
  const t = normTime(iso);
  const query = `/horizons?COMMAND='${encodeURIComponent(String(command))}'&EPHEM_TYPE=VECTORS&TLIST='${encodeURIComponent(
    t,
  )}'&OBJ_DATA=NO&OUT_UNITS=AU-D&format=json`;
  const resp = await getJSON<{ result?: string } | string>(query);
  const text: string = typeof resp === 'string' ? resp : resp?.result ?? '';
  if (!text.trim()) throw new Error('Horizons: empty result');
  const parsed = parseHorizonsVectors(text);
  const jd = Number.isFinite(parsed.jd) ? parsed.jd : jdFromDate(new Date(iso));
  return { jd, posAU: parsed.posAU, velAUPerDay: parsed.velAUPerDay };
}

export async function horizonsDailyVectors(spk: string | number, date: Date): Promise<VectorSample[]> {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const nextDay = addDays(dayStart, 1);
  const samples = await Promise.all([horizonsVectors(spk, dayStart), horizonsVectors(spk, nextDay)]);
  return samples.filter(sample => isFinite3(sample.posAU) && isFinite3(sample.velAUPerDay));
}

export async function loadAtlasSBDB(): Promise<Keplerian> {
  const data = await getJSON<any>('/sbdb?sstr=3I');
  const el = data?.orbit?.elements?.[0] ?? data?.elements?.[0] ?? data?.orbit ?? null;
  if (!el) throw new Error('ATLAS SBDB: no elements');

  const a = Number(el.a);
  const e = Number(el.e);
  const i = Number(el.i ?? el.inc ?? el.incl);
  const Omega = Number(el.om ?? el.Omega ?? el.node);
  const omega = Number(el.w ?? el.argp ?? el.peri);
  const M = Number(el.ma ?? el.M);
  const epochJD = Number(el.epoch_jd ?? el.epoch);

  if (![a, e, i, Omega, omega, M, epochJD].every(Number.isFinite) || !(a > 0) || e < 0 || e >= 1) {
    throw new Error('ATLAS SBDB: invalid element values');
  }

  return {
    a,
    e,
    i: i * DEG2RAD,
    Omega: Omega * DEG2RAD,
    omega: omega * DEG2RAD,
    M: M * DEG2RAD,
    epochJD,
  };
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
  parseHorizonsVectors,
};
