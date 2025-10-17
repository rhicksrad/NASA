import { ATLAS_SBDB_PATH, BASE } from './base';
import type { NeoBrowse } from '../types/nasa';

const JD_UNIX_EPOCH = 2440587.5;
const K = 0.01720209895;
const MU = K * K;

export class HttpError extends Error {
  constructor(public url: string, public status: number, public bodyText: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

async function getTextOrJSON(path: string): Promise<string | unknown> {
  const url = `${BASE}${path}`;
  const response = await fetch(url, { credentials: 'omit' });
  const text = await response.text();
  if (!response.ok) throw new HttpError(url, response.status, text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function firstRecordFromArray(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return asRecord(value[0]);
}

export async function tryNeoBrowse(size = 50): Promise<NeoBrowse | null> {
  try {
    const data = await getTextOrJSON(`/neo/browse?size=${size}`);
    if (typeof data !== 'object' || data === null) {
      throw new Error('NEO browse: unexpected response type');
    }
    return data as NeoBrowse;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 429)) {
      return null;
    }
    throw error;
  }
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
  const result = await getTextOrJSON(path);
  const resultText = typeof result === 'string' ? result : JSON.stringify(result);

  const block = extractHorizonsBlock(resultText);
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
  const data = await getTextOrJSON(ATLAS_SBDB_PATH);

  const root = asRecord(data);
  const objectOrbit = asRecord(asRecord(root?.object)?.orbit);
  const orbitRecord =
    firstRecordFromArray(objectOrbit?.elements) ??
    firstRecordFromArray(asRecord(root?.orbit)?.elements) ??
    asRecord(root?.orbit) ??
    firstRecordFromArray(root?.elements) ??
    undefined;

  if (!orbitRecord) throw new Error('ATLAS SBDB: no elements');

  const N = (value: unknown): number => (value == null ? Number.NaN : Number(value));

  const rawA = N(orbitRecord['a']);
  const rawE = N(orbitRecord['e']);
  const rawI = N(orbitRecord['i'] ?? orbitRecord['inc'] ?? orbitRecord['incl']);
  const rawOmega = N(orbitRecord['om'] ?? orbitRecord['Omega'] ?? orbitRecord['node']);
  const rawOmegaArg = N(orbitRecord['w'] ?? orbitRecord['argp'] ?? orbitRecord['peri']);
  const rawEpochJD = N(orbitRecord['epoch_jd'] ?? orbitRecord['epoch']);
  const rawM = N(orbitRecord['ma'] ?? orbitRecord['M']);

  const rawTp = N(orbitRecord['tp_jd'] ?? orbitRecord['tp']);
  const rawQ = N(orbitRecord['q']);

  const e = rawE;
  if (!Number.isFinite(e) || e <= 0) throw new Error('ATLAS SBDB: invalid element values');

  const i = degToRad(rawI);
  const Omega = degToRad(rawOmega);
  const omega = degToRad(rawOmegaArg);

  return {
    a: Number.isFinite(rawA) ? rawA : undefined,
    e,
    i,
    Omega,
    omega,
    epochJD: Number.isFinite(rawEpochJD) ? rawEpochJD : undefined,
    M0: Number.isFinite(rawM) ? degToRad(rawM) : undefined,
    tp_jd: Number.isFinite(rawTp) ? rawTp : undefined,
    q: Number.isFinite(rawQ) ? rawQ : undefined,
  };
}

export type ConicState = {
  posAU: [number, number, number];
  velAUPerDay: [number, number, number];
};

export function propagateConic(el: Elements, tJD: number): ConicState {
  const { a, e, i, Omega, omega, epochJD, M0, tp_jd, q } = el;

  if (!(e > 0)) throw new Error('Conic propagation requires eccentricity > 0');

  if (e > 1 + 1e-12) {
    const aAbs = Number.isFinite(a) && (a as number) !== 0
      ? Math.abs(a as number)
      : Number.isFinite(q) ? (q as number) / (e - 1) : Number.NaN;
    if (!Number.isFinite(aAbs)) throw new Error('hyperbolic: missing a/q');

    const n = Math.sqrt(MU / (aAbs * aAbs * aAbs));
    const M = Number.isFinite(tp_jd)
      ? n * (tJD - (tp_jd as number))
      : Number.isFinite(M0) && Number.isFinite(epochJD)
        ? (M0 as number) + n * (tJD - (epochJD as number))
        : Number.NaN;
    if (!Number.isFinite(M)) throw new Error('hyperbolic: missing epoch');

    let H = Math.asinh((M as number) / e);
    for (let k = 0; k < 60; k += 1) {
      const sH = Math.sinh(H);
      const cH = Math.cosh(H);
      const f = e * sH - H - (M as number);
      const fp = e * cH - 1;
      const dH = -f / fp;
      H += dH;
      if (Math.abs(dH) < 1e-13) break;
    }

    const r = aAbs * (e * Math.cosh(H) - 1);
    const nu = 2 * Math.atan2(
      Math.sqrt(e + 1) * Math.sinh(H / 2),
      Math.sqrt(e - 1) * Math.cosh(H / 2),
    );
    return perifocalToEcliptic(r, nu, e, aAbs, i, Omega, omega);
  }

  if (Math.abs(e - 1) <= 1e-12) {
    const qp = Number.isFinite(q) ? (q as number) : Number.isFinite(a) ? (a as number) * (1 - e) : Number.NaN;
    if (!Number.isFinite(qp) || !Number.isFinite(tp_jd)) throw new Error('parabolic: missing q or tp');
    const D = solveBarker(tJD - (tp_jd as number), qp);
    const r = qp * (1 + D * D);
    const nu = 2 * Math.atan(D);
    return perifocalToEcliptic(r, nu, e, qp, i, Omega, omega);
  }

  if (!(Number.isFinite(a) && (a as number) > 0)) throw new Error('elliptic: a<=0');
  const aEll = a as number;
  const n = Math.sqrt(MU / (aEll * aEll * aEll));
  const M = Number.isFinite(epochJD) && Number.isFinite(M0)
    ? (M0 as number) + n * (tJD - (epochJD as number))
    : Number.NaN;
  if (!Number.isFinite(M)) throw new Error('elliptic: missing M0/epoch');

  let E = M as number;
  for (let k = 0; k < 60; k += 1) {
    const f = E - e * Math.sin(E) - (M as number);
    const fp = 1 - e * Math.cos(E);
    const dE = -f / fp;
    E += dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  const r = aEll * (1 - e * Math.cos(E));
  const nu = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2),
  );
  return perifocalToEcliptic(r, nu, e, aEll, i, Omega, omega);
}

function perifocalToEcliptic(
  r: number,
  nu: number,
  e: number,
  a: number,
  inc: number,
  Omega: number,
  omega: number,
): ConicState {
  const cosNu = Math.cos(nu);
  const sinNu = Math.sin(nu);
  const xP = r * cosNu;
  const yP = r * sinNu;

  const cO = Math.cos(Omega);
  const sO = Math.sin(Omega);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const cw = Math.cos(omega);
  const sw = Math.sin(omega);

  const R11 = cO * cw - sO * sw * ci;
  const R12 = -cO * sw - sO * cw * ci;
  const R21 = sO * cw + cO * sw * ci;
  const R22 = -sO * sw + cO * cw * ci;
  const R31 = sw * si;
  const R32 = cw * si;

  const x = R11 * xP + R12 * yP;
  const y = R21 * xP + R22 * yP;
  const z = R31 * xP + R32 * yP;

  const p = Math.abs(e - 1) <= 1e-12
    ? 2 * a
    : e >= 1
      ? a * (e * e - 1)
      : a * (1 - e * e);
  if (!Number.isFinite(p) || p === 0) throw new Error('Invalid semi-latus rectum');
  const h = Math.sqrt(MU * Math.abs(p));
  const rx = (-h / p) * Math.sin(nu);
  const ry = (h / p) * (e + Math.cos(nu));

  const vx = R11 * rx + R12 * ry;
  const vy = R21 * rx + R22 * ry;
  const vz = R31 * rx + R32 * ry;

  return { posAU: [x, y, z], velAUPerDay: [vx, vy, vz] };
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
