/* eslint-disable no-console */
import { BASE, getJSON } from './nasaClient';
import type { NeoBrowse } from '../types/nasa';
import { jdFromDate } from '../utils/orbit';
import type { ConicElements } from '../orbits';

const DAY_MS = 86_400_000;

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

export async function loadAtlasSBDB(): Promise<ConicElements> {
  const data = await getJSON<any>(`${BASE}/sbdb?sstr=3I`);
  const el =
    data?.object?.orbit?.elements?.[0] ??
    data?.orbit?.elements?.[0] ??
    data?.orbit ??
    data?.elements?.[0] ??
    null;
  if (!el) throw new Error('ATLAS SBDB: no elements');

  const N = (value: unknown) => (value == null ? Number.NaN : Number(value));

  const a = N(el.a);
  const e = N(el.e);
  const inc = (N(el.i ?? el.inc ?? el.incl) * Math.PI) / 180;
  const Omega = (N(el.om ?? el.Omega ?? el.node) * Math.PI) / 180;
  const omega = (N(el.w ?? el.argp ?? el.peri) * Math.PI) / 180;
  const epochJD = N(el.epoch_jd ?? el.epoch);
  const Mdeg = N(el.ma ?? el.M);
  const M0 = Number.isFinite(Mdeg) ? (Mdeg * Math.PI) / 180 : Number.NaN;
  const tp_jd = N(el.tp_jd ?? el.tp);
  const q = N(el.q);

  if (!Number.isFinite(inc) || !Number.isFinite(Omega) || !Number.isFinite(omega)) {
    throw new Error('ATLAS SBDB: invalid element values');
  }

  if (!Number.isFinite(e) || e <= 0) {
    throw new Error('ATLAS SBDB: invalid element values');
  }

  return { a, e, inc, Omega, omega, epochJD, M0, tp_jd, q };
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
