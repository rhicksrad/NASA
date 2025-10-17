// src/neo3dData.ts
// Single-source data layer for NEO 3D: Horizons vectors, SBDB elements, and propagation.
// No direct NASA/JPL calls; everything goes through the Cloudflare worker.

const BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';

// ---------- HTTP ----------

export class HttpError extends Error {
  constructor(public url: string, public status: number, public bodyText: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

async function getTextOrJSON(path: string): Promise<string | any> {
  const url = `${BASE}${path}`;
  const r = await fetch(url, { credentials: 'omit' });
  const t = await r.text();
  if (!r.ok) throw new HttpError(url, r.status, t);
  try { return JSON.parse(t); } catch { return t; }
}

export async function tryNeoBrowse(size = 20) {
  try { return await getTextOrJSON(`/neo/browse?size=${size}`); }
  catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 429)) return null;
    throw e;
  }
}

// ---------- Time / Units ----------

const K = 0.01720209895;          // Gaussian gravitational constant
const MU = K * K;                 // AU^3 / day^2
const JD_UNIX_EPOCH = 2440587.5;

export function jdFromDateUTC(d: Date): number {
  return JD_UNIX_EPOCH + d.getTime() / 86400000;
}
function toHorizonsCalendar(iso: string): string {
  // Horizons wants 'YYYY-MM-DD HH:MM:SS' (space, no trailing Z)
  return iso.replace('T', ' ').replace(/Z$/i, '');
}

// ---------- Horizons (planets, moons) ----------

export async function horizonsVectors(spk: number | string, iso: string) {
  const t = encodeURIComponent(toHorizonsCalendar(iso));
  const cmd = encodeURIComponent(String(spk));
  const path =
    `/horizons?COMMAND='${cmd}'&EPHEM_TYPE=VECTORS&TLIST='${t}'&OBJ_DATA=NO&OUT_UNITS=AU-D&format=json`;
  const resp = await getTextOrJSON(path);
  const text: string = typeof resp === 'string' ? resp : (resp.result ?? '');
  return parseHorizonsVectors(text);
}

export function parseHorizonsVectors(resultText: string) {
  // Find the $$SOE...$$EOE section and extract first XYZ + VX,VY,VZ lines
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
  a?: number;        // AU (can be <0 for hyperbola)
  e: number;         // eccentricity
  i: number;         // rad
  Omega: number;     // rad
  omega: number;     // rad
  epochJD?: number;  // JD of osculating elements
  M0?: number;       // rad (at epochJD)
  tp_jd?: number;    // JD of perihelion
  q?: number;        // AU perihelion distance
};

export async function loadAtlasSBDB(): Promise<Elements> {
  // Canonical working endpoint for ATLAS
  const data = await getTextOrJSON(`/sbdb?sstr=3I`);

  // Accept several shapes SBDB may return
  const el =
    data?.object?.orbit?.elements?.[0] ??
    data?.orbit?.elements?.[0] ??
    data?.orbit ??
    data?.elements?.[0] ??
    null;

  if (!el) throw new Error('ATLAS SBDB: no elements');

  const N = (x: any) => (x == null ? NaN : Number(x));

  const a     = N(el.a);                         // may be negative or NaN
  const e     = N(el.e);
  const i     = degToRad(N(el.i ?? el.inc ?? el.incl));
  const Omega = degToRad(N(el.om ?? el.Omega ?? el.node));
  const omega = degToRad(N(el.w  ?? el.argp  ?? el.peri));
  const epochJD = N(el.epoch_jd ?? el.epoch);
  const M0      = isFinite(N(el.ma ?? el.M)) ? degToRad(N(el.ma ?? el.M)) : NaN;

  const tp_jd = N(el.tp_jd ?? el.tp);
  const q     = N(el.q);

  if (!isFinite(e) || e <= 0) throw new Error('ATLAS SBDB: invalid element values');
  return { a: isFinite(a) ? a : undefined, e, i, Omega, omega, epochJD: isFinite(epochJD) ? epochJD : undefined, M0: isFinite(M0) ? M0 : undefined, tp_jd: isFinite(tp_jd) ? tp_jd : undefined, q: isFinite(q) ? q : undefined };
}

// ---------- Propagation (universal conic) ----------

export function propagateConic(el: Elements, tJD: number) {
  const { a, e, i, Omega, omega, epochJD, M0, tp_jd, q } = el;

  if (e > 1 + 1e-12) {
    // Hyperbolic: prefer perihelion time
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
    const r  = (ah) * (e * Math.cosh(H) - 1); // AU, positive
    const nu = 2 * Math.atan2(Math.sqrt(e + 1) * Math.sinh(H / 2), Math.sqrt(e - 1) * Math.cosh(H / 2));
    return perifocalToEcliptic(r, nu, e, ah, i, Omega, omega);
  }

  if (Math.abs(e - 1) <= 1e-12) {
    // Parabolic: need q and tp
    const qp = isFinite(q as number) ? (q as number) : (isFinite(a as number) ? (a as number) * (1 - e) : NaN);
    if (!isFinite(qp) || !isFinite(tp_jd as number)) throw new Error('parabolic: missing q or tp');
    const D = solveBarker((tJD - (tp_jd as number)), qp);
    const r = qp * (1 + D * D);
    const nu = 2 * Math.atan(D);
    return perifocalToEcliptic(r, nu, e, Infinity, i, Omega, omega);
  }

  // Elliptic: 0 < e < 1
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
  // dt = sqrt(q^3/mu)*(D + D^3/3) -> solve for D via Newton
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
  let vx = 0, vy = 0, vz = 0;
  if (e >= 1) {
    // hyperbola/parabola: express using p and h
    const p = e > 1 ? a * (1 - e * e) : 2 * (isFinite(a) ? a * (1 - e) : r / (1 + Math.cos(nu))); // p positive
    const h = Math.sqrt(MU * Math.abs(p));
    const rx = -h / p * Math.sin(nu);
    const ry =  h / p * (e + Math.cos(nu));
    vx = R11 * rx + R12 * ry;
    vy = R21 * rx + R22 * ry;
    vz = R31 * rx + R32 * ry;
  } else {
    const p = a * (1 - e * e);
    const h = Math.sqrt(MU * p);
    const rx = -h / p * Math.sin(nu);
    const ry =  h / p * (e + Math.cos(nu));
    vx = R11 * rx + R12 * ry;
    vy = R21 * rx + R22 * ry;
    vz = R31 * rx + R32 * ry;
  }

  return { posAU: [x, y, z] as [number, number, number], velAUPerDay: [vx, vy, vz] as [number, number, number] };
}

function degToRad(d: number) { return (d * Math.PI) / 180; }

// ---------- Guards ----------

export function isFiniteVec3(v: number[] | undefined | null): v is [number, number, number] {
  return !!v && v.length === 3 && v.every(Number.isFinite);
}

