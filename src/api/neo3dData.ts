import type { NeoBrowse } from '../types/nasa';

const BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';
const JD_UNIX_EPOCH = 2440587.5;
const K = 0.01720209895;
const MU = K * K;

export class HttpError extends Error {
  constructor(public url: string, public status: number, public bodyText: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

interface FetchResult {
  url: string;
  status: number;
  ok: boolean;
  text: string;
}

async function request(path: string): Promise<FetchResult> {
  const url = `${BASE}${path}`;
  const response = await fetch(url, { credentials: 'omit' });
  const text = await response.text();
  return { url, status: response.status, ok: response.ok, text };
}

function parseJSON<T>(text: string, url: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Invalid JSON from ${url}: ${(error as Error).message}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstRecordFromArray(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return asRecord(value[0]);
}

export async function tryNeoBrowse(size = 50): Promise<NeoBrowse | null> {
  const { url, status, ok, text } = await request(`/neo/browse?size=${size}`);
  if (!ok) {
    if (status === 401 || status === 429) return null;
    throw new HttpError(url, status, text);
  }
  return parseJSON<NeoBrowse>(text, url);
}

export type VectorSample = {
  t: Date;
  jd: number;
  posAU: [number, number, number];
  velAUPerDay: [number, number, number];
};

export function jdFromDateUTC(date: Date): number {
  return JD_UNIX_EPOCH + date.getTime() / 86400000;
}

function normalizeIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  return `${date.toISOString().slice(0, 19)}Z`;
}

export async function horizonsVectors(spk: number | string, iso: string) {
  const tlist = normalizeIso(iso).replace('T', ' ').replace(/Z$/, '');
  const path =
    `/horizons?COMMAND='${encodeURIComponent(String(spk))}'&EPHEM_TYPE=VECTORS&TLIST='${encodeURIComponent(tlist)}'&OBJ_DATA=NO&OUT_UNITS=AU-D&TIME_TYPE=UT&format=json&MAKE_EPHEM=YES&CENTER=500@10&REF_PLANE=ECLIPTIC&REF_SYSTEM=J2000`;
  const { url, ok, status, text } = await request(path);
  if (!ok) throw new HttpError(url, status, text);

  const block = extractHorizonsBlock(text);
  const pos = extractVector(block, 'X', 'Y', 'Z');
  const vel = extractVector(block, 'VX', 'VY', 'VZ');
  return { posAU: pos, velAUPerDay: vel };
}

function extractHorizonsBlock(resultText: string): string {
  const start = resultText.indexOf('$$SOE');
  const end = resultText.indexOf('$$EOE', start + 5);
  if (start === -1 || end === -1) {
    throw new Error('Horizons: missing $$SOE/$$EOE block');
  }
  return resultText.slice(start + 5, end).trim();
}

function extractVector(block: string, a: string, b: string, c: string): [number, number, number] {
  const numberPattern = String.raw`([+-]?\d+(?:\.\d+)?(?:E[+-]?\d+)?)`;
  const pattern = new RegExp(
    String.raw`${a}\s*=\s*${numberPattern}\s*${b}\s*=\s*${numberPattern}\s*${c}\s*=\s*${numberPattern}`,
    'i',
  );
  const match = block.replace(/\s+/g, ' ').match(pattern);
  if (!match) {
    throw new Error(`Horizons: missing ${a}/${b}/${c} vector`);
  }
  const vec: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!vec.every(Number.isFinite)) {
    throw new Error('Horizons: non-finite vectors');
  }
  return vec;
}

export async function horizonsDailyVectors(
  spk: number | string,
  startIso: string,
  days: number,
): Promise<VectorSample[]> {
  const normalized = normalizeIso(startIso);
  const startDate = new Date(normalized);
  const samples: VectorSample[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(startDate.getTime() + i * 86400000);
    const iso = `${date.toISOString().slice(0, 19)}Z`;
    const state = await horizonsVectors(spk, iso);
    const t = new Date(iso);
    samples.push({ t, jd: jdFromDateUTC(t), posAU: state.posAU, velAUPerDay: state.velAUPerDay });
  }
  return samples;
}

export type Elements = {
  a?: number;
  e: number;
  i: number;
  Omega: number;
  omega: number;
  epochJD?: number;
  M0?: number;
  tp_jd?: number;
  q?: number;
};

export async function loadAtlasSBDB(): Promise<Elements> {
  const { url, ok, status, text } = await request(`/sbdb?sstr=3I`);
  if (!ok) throw new HttpError(url, status, text);
  const data = parseJSON<Record<string, unknown>>(text, url);

  const root = asRecord(data);
  const objectOrbit = asRecord(asRecord(root?.object)?.orbit);
  const orbitRecord =
    firstRecordFromArray(objectOrbit?.elements) ??
    firstRecordFromArray(asRecord(root?.orbit)?.elements) ??
    asRecord(root?.orbit) ??
    firstRecordFromArray(root?.elements) ??
    null;

  if (!orbitRecord) {
    throw new Error('ATLAS SBDB: missing orbit elements');
  }

  const getRawNumber = (key: string): number => {
    const value = orbitRecord[key];
    if (value == null) return Number.NaN;
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  const pick = (...keys: string[]): number => {
    for (const key of keys) {
      const n = getRawNumber(key);
      if (Number.isFinite(n)) return n;
    }
    return Number.NaN;
  };

  const a = getRawNumber('a');
  const e = getRawNumber('e');
  const iDeg = pick('i', 'inc', 'incl');
  const OmegaDeg = pick('om', 'Omega', 'node');
  const omegaDeg = pick('w', 'argp', 'peri');
  const epochJD = pick('epoch_jd', 'epoch');
  const mDeg = pick('ma', 'M');
  const tp_jd = pick('tp_jd', 'tp');
  const q = pick('q');

  if (!(e > 0)) {
    throw new Error('ATLAS SBDB: eccentricity must be > 0');
  }

  const i = degToRad(iDeg);
  const Omega = degToRad(OmegaDeg);
  const omega = degToRad(omegaDeg);
  if (![i, Omega, omega].every(Number.isFinite)) {
    throw new Error('ATLAS SBDB: invalid angular elements');
  }

  const elements: Elements = {
    e,
    i,
    Omega,
    omega,
  };

  if (Number.isFinite(a)) {
    elements.a = a;
  } else if (Number.isFinite(q)) {
    if (e < 1) {
      elements.a = q / (1 - e);
    } else {
      elements.a = -Math.abs(q) / (e - 1);
    }
  }

  if (Number.isFinite(epochJD)) elements.epochJD = epochJD;
  const M0 = Number.isFinite(mDeg) ? degToRad(mDeg) : Number.NaN;
  if (Number.isFinite(M0)) elements.M0 = M0;
  if (Number.isFinite(tp_jd)) elements.tp_jd = tp_jd;
  if (Number.isFinite(q)) elements.q = q;

  if (e > 1 && (!Number.isFinite(elements.tp_jd ?? Number.NaN) || !Number.isFinite(elements.q ?? Number.NaN))) {
    throw new Error('ATLAS SBDB: hyperbolic orbit missing tp_jd or q');
  }

  return elements;
}

export type ConicState = {
  posAU: [number, number, number];
  velAUPerDay: [number, number, number];
};

export function propagateConic(el: Elements, tJD: number): ConicState {
  const e = el.e;
  if (!(e > 0)) {
    throw new Error('Conic propagation requires eccentricity > 0');
  }

  if (e < 1 - 1e-12) {
    return propagateElliptic(el, tJD);
  }
  if (Math.abs(e - 1) <= 1e-12) {
    return propagateParabolic(el, tJD);
  }
  return propagateHyperbolic(el, tJD);
}

function propagateElliptic(el: Elements, tJD: number): ConicState {
  if (!(el.a && el.a > 0)) throw new Error('Elliptic orbit requires positive semi-major axis');
  const a = el.a;
  const e = el.e;
  const n = Math.sqrt(MU / (a * a * a));
  let M = Number.NaN;
  if (Number.isFinite(el.tp_jd)) {
    M = n * (tJD - (el.tp_jd as number));
  } else if (Number.isFinite(el.M0) && Number.isFinite(el.epochJD)) {
    M = (el.M0 as number) + n * (tJD - (el.epochJD as number));
  }
  if (!Number.isFinite(M)) {
    throw new Error('Elliptic orbit missing epoch information');
  }

  let E = M;
  for (let k = 0; k < 80; k += 1) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const dE = -f / fp;
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }

  const cosE = Math.cos(E);
  const r = a * (1 - e * cosE);
  const sinHalf = Math.sin(E / 2);
  const cosHalf = Math.cos(E / 2);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * sinHalf, Math.sqrt(1 - e) * cosHalf);
  return finalizeState(r, nu, e, a, el);
}

function propagateParabolic(el: Elements, tJD: number): ConicState {
  let q = el.q;
  if (!Number.isFinite(q) && Number.isFinite(el.a)) {
    q = (el.a as number) * (1 - el.e);
  }
  if (!Number.isFinite(q) || !Number.isFinite(el.tp_jd)) {
    throw new Error('Parabolic orbit requires q and tp_jd');
  }
  const dt = tJD - (el.tp_jd as number);
  const D = solveBarker(dt, q as number);
  const nu = 2 * Math.atan(D);
  const r = (q as number) * (1 + D * D);
  return finalizeState(r, nu, el.e, undefined, el, 2 * (q as number));
}

function propagateHyperbolic(el: Elements, tJD: number): ConicState {
  let a = Number.isFinite(el.a) ? (el.a as number) : Number.NaN;
  if (!Number.isFinite(a) && Number.isFinite(el.q)) {
    a = -Math.abs(el.q as number) / (el.e - 1);
  }
  if (!Number.isFinite(a) || a === 0) {
    throw new Error('Hyperbolic orbit requires semi-major axis or q');
  }
  if (a > 0) a = -a;

  const e = el.e;
  const n = Math.sqrt(MU / Math.abs(a * a * a));
  let M = Number.NaN;
  if (Number.isFinite(el.tp_jd)) {
    M = n * (tJD - (el.tp_jd as number));
  } else if (Number.isFinite(el.M0) && Number.isFinite(el.epochJD)) {
    M = (el.M0 as number) + n * (tJD - (el.epochJD as number));
  }
  if (!Number.isFinite(M)) {
    throw new Error('Hyperbolic orbit missing epoch information');
  }

  let H = Math.asinh(M / e);
  for (let k = 0; k < 80; k += 1) {
    const s = Math.sinh(H);
    const c = Math.cosh(H);
    const f = e * s - H - M;
    const fp = e * c - 1;
    const dH = -f / fp;
    H += dH;
    if (Math.abs(dH) < 1e-12) break;
  }

  const nu = 2 * Math.atan2(
    Math.sqrt(e + 1) * Math.sinh(H / 2),
    Math.sqrt(e - 1) * Math.cosh(H / 2),
  );
  const p = Math.abs(a) * (e * e - 1);
  const r = p / (1 + e * Math.cos(nu));
  return finalizeState(r, nu, e, a, el, p);
}

function finalizeState(
  r: number,
  nu: number,
  e: number,
  a: number | undefined,
  el: Elements,
  pOverride?: number,
): ConicState {
  const cosNu = Math.cos(nu);
  const sinNu = Math.sin(nu);
  const xP = r * cosNu;
  const yP = r * sinNu;

  let p = pOverride;
  if (!Number.isFinite(p)) {
    if (a && e < 1) {
      p = a * (1 - e * e);
    } else if (a) {
      p = Math.abs(a) * (e * e - 1);
    }
  }
  if (!Number.isFinite(p) || (p as number) === 0) {
    throw new Error('Unable to determine semi-latus rectum');
  }

  const sqrtMuOverP = Math.sqrt(MU / (p as number));
  const vxP = -sqrtMuOverP * Math.sin(nu);
  const vyP = sqrtMuOverP * (e + Math.cos(nu));

  const cO = Math.cos(el.Omega);
  const sO = Math.sin(el.Omega);
  const ci = Math.cos(el.i);
  const si = Math.sin(el.i);
  const cw = Math.cos(el.omega);
  const sw = Math.sin(el.omega);

  const R11 = cO * cw - sO * sw * ci;
  const R12 = -cO * sw - sO * cw * ci;
  const R21 = sO * cw + cO * sw * ci;
  const R22 = -sO * sw + cO * cw * ci;
  const R31 = sw * si;
  const R32 = cw * si;

  const pos: [number, number, number] = [
    R11 * xP + R12 * yP,
    R21 * xP + R22 * yP,
    R31 * xP + R32 * yP,
  ];

  const vel: [number, number, number] = [
    R11 * vxP + R12 * vyP,
    R21 * vxP + R22 * vyP,
    R31 * vxP + R32 * vyP,
  ];

  if (![...pos, ...vel].every(Number.isFinite)) {
    throw new Error('Conic propagation produced non-finite state');
  }

  return { posAU: pos, velAUPerDay: vel };
}

function solveBarker(dtDays: number, q: number): number {
  const B = dtDays * Math.sqrt(MU / (q * q * q));
  let D = Math.cbrt(B);
  for (let k = 0; k < 80; k += 1) {
    const f = D + (D * D * D) / 3 - B;
    const fp = 1 + D * D;
    const dD = -f / fp;
    D += dD;
    if (Math.abs(dD) < 1e-12) break;
  }
  return D;
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

export function isFiniteVec3(v: number[] | null | undefined): v is [number, number, number] {
  return !!v && v.length === 3 && v.every(Number.isFinite);
}
