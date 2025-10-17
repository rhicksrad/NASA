const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const K = 0.01720209895; // sqrt(GM_sun) AU^(3/2)/day
const DAY_MS = 86_400_000;

export interface Keplerian {
  a: number;
  e: number;
  i: number;
  Omega: number;
  omega: number;
  M: number;
  epochJD: number;
}

export function jdFromDate(date: Date): number {
  return date.getTime() / DAY_MS + 2440587.5;
}

function wrapPi(angle: number): number {
  return ((angle + Math.PI) % TWO_PI) - Math.PI;
}

function solveElliptic(mean: number, e: number): number {
  let eccentric = e < 0.8 ? mean : Math.PI;
  for (let k = 0; k < 30; k += 1) {
    const f = eccentric - e * Math.sin(eccentric) - mean;
    const fp = 1 - e * Math.cos(eccentric);
    const delta = -f / fp;
    eccentric += delta;
    if (Math.abs(delta) < 1e-12) {
      break;
    }
  }
  return eccentric;
}

function solveHyperbolic(mean: number, e: number): number {
  let hyper = Math.log((2 * Math.abs(mean)) / e + 1.8);
  if (mean < 0) {
    hyper = -hyper;
  }
  for (let k = 0; k < 50; k += 1) {
    const s = Math.sinh(hyper);
    const c = Math.cosh(hyper);
    const f = e * s - hyper - mean;
    const fp = e * c - 1;
    const delta = -f / fp;
    hyper += delta;
    if (Math.abs(delta) < 1e-12) {
      break;
    }
  }
  return hyper;
}

export function propagate(els: Keplerian, jd: number): [number, number, number] {
  const e = els.e;
  const incl = els.i * DEG;
  const asc = els.Omega * DEG;
  const arg = els.omega * DEG;
  const dt = jd - els.epochJD;

  let xp = 0;
  let yp = 0;

  if (e < 1) {
    const a = els.a;
    const motion = K / Math.sqrt(a * a * a);
    const mean = wrapPi(els.M * DEG + motion * dt);
    const eccentric = solveElliptic(mean, e);
    const radius = a * (1 - e * Math.cos(eccentric));
    const s = Math.sqrt(1 - e * e);
    const cosv = (Math.cos(eccentric) - e) / (1 - e * Math.cos(eccentric));
    const sinv = (s * Math.sin(eccentric)) / (1 - e * Math.cos(eccentric));
    xp = radius * cosv;
    yp = radius * sinv;
  } else {
    const aAbs = Math.abs(els.a);
    const motion = K / Math.sqrt(aAbs * aAbs * aAbs);
    const mean = els.M * DEG + motion * dt;
    const hyper = solveHyperbolic(mean, e);
    const ch = Math.cosh(hyper);
    const sh = Math.sinh(hyper);
    const radius = aAbs * (e * ch - 1);
    const s = Math.sqrt(e * e - 1);
    const cosv = (e - ch) / (e * ch - 1);
    const sinv = (s * sh) / (e * ch - 1);
    xp = radius * cosv;
    yp = radius * sinv;
  }

  const cO = Math.cos(asc);
  const sO = Math.sin(asc);
  const ci = Math.cos(incl);
  const si = Math.sin(incl);
  const cw = Math.cos(arg);
  const sw = Math.sin(arg);

  const x = (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp;
  const y = (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp;
  const z = si * (-sw * xp + cw * yp);

  return [x, y, z];
}

export function earthElementsApprox(epochJD = 2451545.0): Keplerian {
  return {
    a: 1.00000261,
    e: 0.01671123,
    i: 0.00005,
    Omega: -11.26064,
    omega: 102.94719,
    M: 100.46435,
    epochJD,
  };
}

export interface SbdbOrbitRecord {
  e: string;
  a?: string;
  q?: string;
  i: string;
  om: string;
  w: string;
  ma?: string;
  M?: string;
  epoch: string;
}

export function fromSbdb(orbit: SbdbOrbitRecord): Keplerian {
  const e = Number(orbit.e);
  const i = Number(orbit.i);
  const Omega = Number(orbit.om);
  const omega = Number(orbit.w);
  const epochJD = Number(orbit.epoch);

  const Mdeg = orbit.ma != null ? Number(orbit.ma) : orbit.M != null ? Number(orbit.M) : 0;

  let a = orbit.a != null ? Number(orbit.a) : undefined;
  const q = orbit.q != null ? Number(orbit.q) : undefined;

  if (a == null && q != null) {
    a = e < 1 ? q / (1 - e) : -q / (e - 1);
  }

  if (a == null) {
    throw new Error('Cannot derive semi-major axis from SBDB record');
  }

  return { a, e, i, Omega, omega, M: Mdeg, epochJD };
}
