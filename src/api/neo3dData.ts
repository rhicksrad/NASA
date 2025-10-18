import { WORKER_BASE, HttpError, getTextOrJSON as _getTextOrJSON } from './base';
import type { NeoBrowse } from '../types/nasa';

export { WORKER_BASE };

const JD_UNIX_EPOCH = 2440587.5;
const K = 0.01720209895;
const MU = K * K;

const getTextOrJSON = (path: string) => _getTextOrJSON(path);

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

type SbdbElementsEntry = {
  name?: string;
  label?: string;
  value?: string | number | null;
};

type SbdbResponse = {
  orbit?: {
    elements?: SbdbElementsEntry[];
    epoch?: string | number | null;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSbdbElementsEntry(value: unknown): value is SbdbElementsEntry {
  if (!isRecord(value)) return false;
  const { name, label, value: entryValue } = value;
  const nameOk = name === undefined || typeof name === 'string';
  const labelOk = label === undefined || typeof label === 'string';
  const valueOk =
    entryValue === undefined ||
    entryValue === null ||
    typeof entryValue === 'string' ||
    typeof entryValue === 'number';
  return nameOk && labelOk && valueOk;
}

function isSbdbResponse(value: unknown): value is SbdbResponse {
  if (!isRecord(value)) return false;
  const orbit = value.orbit;
  if (orbit === undefined) return true;
  if (!isRecord(orbit)) return false;
  if (orbit.elements !== undefined) {
    if (!Array.isArray(orbit.elements) || !orbit.elements.every(isSbdbElementsEntry)) {
      return false;
    }
  }
  const { epoch } = orbit;
  return (
    epoch === undefined ||
    epoch === null ||
    typeof epoch === 'string' ||
    typeof epoch === 'number'
  );
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return Number.NaN;
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toElementsMap(arr: SbdbElementsEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of arr) {
    const keySource = entry.name ?? entry.label ?? '';
    if (typeof keySource !== 'string') continue;
    const key = keySource.trim().toLowerCase();
    if (!key) continue;
    const value = toNumber(entry.value ?? null);
    map.set(key, value);
  }
  return map;
}

export async function loadAtlasSBDB(): Promise<Elements> {
  // STRICT: use the exact URL, no extra params
  const data = await getTextOrJSON(`/sbdb?sstr=3I`);

  if (!isSbdbResponse(data)) {
    console.error('[sbdb] unexpected payload (invalid structure):', data);
    throw new Error('ATLAS SBDB: invalid response');
  }

  const elemsArr = data.orbit?.elements ?? null;

  if (!elemsArr || elemsArr.length === 0) {
    console.error('[sbdb] unexpected payload (no orbit.elements array):', data);
    throw new Error('ATLAS SBDB: no elements');
  }

  const M = toElementsMap(elemsArr);
  const deg = (d: number) => (d * Math.PI) / 180;

  // Names we expect in SBDB list:
  // e, a, q, i, om (Ω), w (ω), ma (M), tp (JD TDB), n (deg/d)
  // a can be negative for hyperbola (keep it), e will be > 1
  const a     = M.get('a');           // AU; may be negative for hyperbola
  const e     = M.get('e');           // > 1 for hyperbola
  const i     = deg(M.get('i') ?? NaN);
  const Omega = deg(M.get('om') ?? NaN);
  const omega = deg(M.get('w')  ?? NaN);
  const M0deg = M.get('ma');
  const M0    = isFinite(M0deg as number) ? deg(M0deg as number) : NaN;
  const tp_jd = M.get('tp');
  const q     = M.get('q');

  // Epoch: prefer orbit.epoch if present
  const epochJD = toNumber(data.orbit?.epoch ?? null);

  if (!isFinite(e as number) || (e as number) <= 0) {
    console.error('[sbdb] bad e in elements:', elemsArr);
    throw new Error('ATLAS SBDB: invalid element values');
  }

  return {
    a: isFinite(a as number) ? (a as number) : undefined, // keep sign if negative
    e: e as number,
    i,
    Omega,
    omega,
    epochJD: isFinite(epochJD) ? epochJD : undefined,
    M0: isFinite(M0) ? M0 : undefined,
    tp_jd: isFinite(tp_jd as number) ? (tp_jd as number) : undefined,
    q: isFinite(q as number) ? (q as number) : undefined,
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
    // Use |a| for mean motion and radius math; if a missing, derive from q
    const aAbs = isFinite(a as number) && (a as number) !== 0
      ? Math.abs(a as number)
      : (isFinite(q as number) ? (q as number) / (e - 1) : NaN);
    if (!isFinite(aAbs)) throw new Error('hyperbolic: missing a/q');

    const n = Math.sqrt(MU / (aAbs * aAbs * aAbs));
    const M = isFinite(tp_jd as number)
      ? n * (tJD - (tp_jd as number))
      : (isFinite(M0 as number) && isFinite(epochJD as number)
          ? (M0 as number) + n * (tJD - (epochJD as number))
          : NaN);
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
    const r  = aAbs * (e * Math.cosh(H) - 1); // strictly positive
    const nu = 2 * Math.atan2(
      Math.sqrt(e + 1) * Math.sinh(H / 2),
      Math.sqrt(e - 1) * Math.cosh(H / 2)
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

  const p = e >= 1 ? a * (e * e - 1) : a * (1 - e * e);
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

export function isFiniteVec3(v: number[] | null | undefined): v is [number, number, number] {
  return !!v && v.length === 3 && v.every(Number.isFinite);
}
