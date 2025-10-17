// src/api/neo3dData.ts
// Data layer for NEO 3D: Horizons vectors, SBDB elements, and propagation.
// Only talks to the Cloudflare worker; no direct NASA/JPL calls.

import type { NeoBrowse, NeoItem } from '../types/nasa';
import { buildFallbackBrowse, fallbackNeos } from './neo3dFallback';

const BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';

// ---------- HTTP ----------

export class HttpError extends Error {
  constructor(public url: string, public status: number, public bodyText: string) {
    super(`HTTP ${status} for ${url}`);
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

async function getTextOrJSON<T = unknown>(path: string): Promise<string | T> {
  const url = `${BASE}${path}`;
  const r = await fetch(url, { credentials: 'omit' });
  const t = await r.text();
  if (!r.ok) throw new HttpError(url, r.status, t);
  try {
    return JSON.parse(t) as T;
  } catch {
    return t;
  }
}

// Gate NEO suggestions behind an explicit opt-in to avoid noisy 401s by default.
function suggestionsEnabled(): boolean {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const queryEnable = params.get('neos') ?? params.get('suggest');
    if (queryEnable === '1' || queryEnable?.toLowerCase() === 'true') return true;
    if (queryEnable === '0' || queryEnable?.toLowerCase() === 'false') return false;

    const ls = globalThis.localStorage?.getItem('neo3d:suggestNeos');
    if (ls === '0' || ls?.toLowerCase() === 'false') return false;
    if (ls === '1' || ls?.toLowerCase() === 'true') return true;
  } catch {
    // If storage or URL parsing fails, fall through to default behaviour.
  }
  // Default to enabled so the page shows NEOs out of the box; 401s/429s are still tolerated below.
  return true;
}

// Optional helper; callers can ignore null when disabled or when /neo/browse hits 401/429
export async function tryNeoBrowse(size = 20): Promise<NeoBrowse | null> {
  if (!suggestionsEnabled()) return null;
  try {
    const result = await getTextOrJSON<NeoBrowse>(`/neo/browse?size=${size}`);
    if (result && typeof result === 'object' && 'near_earth_objects' in (result as Record<string, unknown>)) {
      return result as NeoBrowse;
    }
    return buildFallbackBrowse(size);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 429)) return buildFallbackBrowse(size);
    throw e;
  }
}

export function areNeoSuggestionsEnabled(): boolean {
  return suggestionsEnabled();
}

export function fallbackNeoBrowse(size = 20): NeoBrowse {
  return buildFallbackBrowse(size);
}

export function fallbackNeoItems(size = 20): NeoItem[] {
  return fallbackNeos(size);
}

// ---------- Time / Units ----------

const K = 0.01720209895;          // Gaussian gravitational constant
const MU = K * K;                 // AU^3 / day^2
const JD_UNIX_EPOCH = 2440587.5;

export function jdFromDateUTC(d: Date): number {
  return JD_UNIX_EPOCH + d.getTime() / 86400000;
}
function toHorizonsCalendar(iso: string): string {
  return iso.replace('T', ' ').replace(/Z$/i, '');
}
function addDaysISO(iso: string, d: number): string {
  const dt = new Date(iso);
  dt.setUTCDate(dt.getUTCDate() + d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
}

// ---------- Horizons (planets, moons) ----------

export type VectorSample = {
  t: Date;
  posAU: [number, number, number];
  velAUPerDay: [number, number, number];
};

export async function horizonsVectors(spk: number | string, iso: string) {
  const t = encodeURIComponent(toHorizonsCalendar(iso));
  const cmd = encodeURIComponent(String(spk));
  const path =
    `/horizons?COMMAND='${cmd}'&EPHEM_TYPE=VECTORS&TLIST='${t}'&OBJ_DATA=NO&OUT_UNITS=AU-D&format=json`;
  const resp = await getTextOrJSON<{ result?: string }>(path);
  const text: string = typeof resp === 'string' ? resp : (resp.result ?? '');
  return parseHorizonsVectors(text);
}

// IMPORTANT: default days = 1 so callers can omit it.
export async function horizonsDailyVectors(
  spk: number | string,
  startIso: string,
  days = 1
): Promise<VectorSample[]> {
  const out: VectorSample[] = [];
  for (let i = 0; i < days; i++) {
    const iso = addDaysISO(toHorizonsCalendar(startIso), i);
    const v = await horizonsVectors(spk, iso);
    out.push({ t: new Date(iso.replace(' ', 'T') + 'Z'), posAU: v.posAU, velAUPerDay: v.velAUPerDay });
  }
  return out;
}

export function parseHorizonsVectors(resultText: string) {
  const block = resultText.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!block) throw new Error('Horizons: missing $$SOE/$$EOE block');
  const lines = block.trim().split('\n').map(s => s.trim()).filter(Boolean);

  const xyzLine = lines.find(l => l.startsWith('X ='));
  const vLine   = lines.find(l => l.startsWith('VX='));
  if (!xyzLine || !vLine) throw new Error('Horizons: missing XYZ or V lines');

  const num = (s: string) => Number(s.replace(/[^0-9+-.Ee]/g, ''));
  const xyz = [...xyzLine.matchAll(/[XYZ]\s*=\s*([+-]?\d\.\d+E[+-]\d+)/g)].map(m => num(m[1]));
  const vel = [...vLine.matchAll(/V[XYZ]\s*=\s*([+-]?\d\.\d+E[+-]\d+)/g)].map(m => num(m[1]));

  if (xyz.length !== 3 || vel.length !== 3 || ![...xyz, ...vel].every(Number.isFinite)) {
    throw new Error('Horizons: non-finite vectors');
  }
  return { posAU: xyz as [number, number, number], velAUPerDay: vel as [number, number, number] };
}

// ---------- SBDB (small bodies, comets, interstellar) ----------

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
  const data = await getTextOrJSON<Record<string, unknown>>(`/sbdb?sstr=3I`);
  const root = asRecord(data);
  const objectOrbit = asRecord(asRecord(root?.object)?.orbit);
  const rootOrbit = asRecord(root?.orbit);

  const el =
    firstRecordFromArray(objectOrbit?.elements) ??
    firstRecordFromArray(rootOrbit?.elements) ??
    rootOrbit ??
    firstRecordFromArray(root?.elements) ??
    null;

  if (!el) throw new Error('ATLAS SBDB: no elements');

  const N = (x: unknown) => (x == null ? Number.NaN : Number(x));

  const a     = N(el.a);
  const e     = N(el.e);
  const i     = degToRad(N(el.i ?? el.inc ?? el.incl));
  const Omega = degToRad(N(el.om ?? el.Omega ?? el.node));
  const omega = degToRad(N(el.w  ?? el.argp  ?? el.peri));
  const epochJD = N(el.epoch_jd ?? el.epoch);
  const M0      = isFinite(N(el.ma ?? el.M)) ? degToRad(N(el.ma ?? el.M)) : NaN;

  const tp_jd = N(el.tp_jd ?? el.tp);
  const q     = N(el.q);

  if (!isFinite(e) || e <= 0) throw new Error('ATLAS SBDB: invalid element values');
  return {
    a: isFinite(a) ? a : undefined,
    e, i, Omega, omega,
    epochJD: isFinite(epochJD) ? epochJD : undefined,
    M0: isFinite(M0) ? M0 : undefined,
    tp_jd: isFinite(tp_jd) ? tp_jd : undefined,
    q: isFinite(q) ? q : undefined
  };
}

// ---------- Propagation (universal conic) ----------

export function propagateConic(el: Elements, tJD: number) {
  const { a, e, i, Omega, omega, epochJD, M0, tp_jd, q } = el;

  if (e > 1 + 1e-12) {
    const ah = isFinite(a as number) && (a as number) !== 0 ? (a as number) : (isFinite(q as number) ? (q as number) / (e - 1) : NaN);
    if (!isFinite(ah)) throw new Error('hyperbolic: missing a/q');
    const n = Math.sqrt(MU / Math.abs(ah * ah * ah));
    const M = isFinite(tp_jd as number) ? n * (tJD - (tp_jd as number)) : (isFinite(M0 as number) && isFinite(epochJD as number) ? (M0 as number) + n * (tJD - (epochJD as number)) : NaN);
    if (!isFinite(M)) throw new Error('hyperbolic: missing epoch');

    let H = Math.asinh(M / e);
    for (let k = 0; k < 60; k++) {
      const sH = Math.sinh(H), cH = Math.cosh(H);
      const f = e * sH - H - M;
      const fp = e * cH - 1;
      const dH = -f / fp;
      H += dH;
      if (Math.abs(dH) < 1e-13) break;
    }
    const r  = (ah) * (e * Math.cosh(H) - 1);
    const nu = 2 * Math.atan2(Math.sqrt(e + 1) * Math.sinh(H / 2), Math.sqrt(e - 1) * Math.cosh(H / 2));
    return perifocalToEcliptic(r, nu, e, ah, i, Omega, omega);
  }

  if (Math.abs(e - 1) <= 1e-12) {
    const qp = isFinite(q as number) ? (q as number) : (isFinite(a as number) ? (a as number) * (1 - e) : NaN);
    if (!isFinite(qp) || !isFinite(tp_jd as number)) throw new Error('parabolic: missing q or tp');
    const D = solveBarker((tJD - (tp_jd as number)), qp);
    const r = qp * (1 + D * D);
    const nu = 2 * Math.atan(D);
    return perifocalToEcliptic(r, nu, e, Infinity, i, Omega, omega);
  }

  if (!(a as number > 0)) throw new Error('elliptic: a<=0');
  const n = Math.sqrt(MU / ((a as number) * (a as number) * (a as number)));
  const M = isFinite(epochJD as number) && isFinite(M0 as number) ? (M0 as number) + n * (tJD - (epochJD as number)) : NaN;
  if (!isFinite(M)) throw new Error('elliptic: missing M0/epoch');

  let E = M;
  for (let k = 0; k < 60; k++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const dE = -f / fp;
    E += dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  const r = (a as number) * (1 - e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return perifocalToEcliptic(r, nu, e, a as number, i, Omega, omega);
}

function solveBarker(dtDays: number, q: number) {
  const B = dtDays * Math.sqrt(MU / (q * q * q));
  let D = Math.cbrt(B);
  for (let k = 0; k < 60; k++) {
    const f = D + (D * D * D) / 3 - B;
    const fp = 1 + D * D;
    const dD = -f / fp;
    D += dD;
    if (Math.abs(dD) < 1e-13) break;
  }
  return D;
}

function perifocalToEcliptic(r: number, nu: number, e: number, a: number, inc: number, Omega: number, omega: number) {
  const cosNu = Math.cos(nu), sinNu = Math.sin(nu);
  const xP = r * cosNu, yP = r * sinNu;

  const cO = Math.cos(Omega), sO = Math.sin(Omega);
  const ci = Math.cos(inc),   si = Math.sin(inc);
  const cw = Math.cos(omega), sw = Math.sin(omega);

  const R11 = cO * cw - sO * sw * ci, R12 = -cO * sw - sO * cw * ci, R13 = sO * si;
  const R21 = sO * cw + cO * sw * ci, R22 = -sO * sw + cO * cw * ci, R23 = -cO * si;
  const R31 = sw * si,                R32 = cw * si,                 R33 = ci;

  const x = R11 * xP + R12 * yP + R13 * 0;
  const y = R21 * xP + R22 * yP + R23 * 0;
  const z = R31 * xP + R32 * yP + R33 * 0;

  // Velocity (AU/day)
  const p = a * (1 - e * e);
  const h = Math.sqrt(MU * Math.abs(p));
  const rx = -h / p * Math.sin(nu);
  const ry =  h / p * (e + Math.cos(nu));
  const rz =  0;

  const vx = R11 * rx + R12 * ry + R13 * rz;
  const vy = R21 * rx + R22 * ry + R23 * rz;
  const vz = R31 * rx + R32 * ry + R33 * rz;

  return { posAU: [x, y, z] as [number, number, number], velAUPerDay: [vx, vy, vz] as [number, number, number] };
}

function degToRad(d: number) { return (d * Math.PI) / 180; }

// ---------- Guards ----------

export function isFiniteVec3(v: number[] | undefined | null): v is [number, number, number] {
  return !!v && v.length === 3 && v.every(Number.isFinite);
}
