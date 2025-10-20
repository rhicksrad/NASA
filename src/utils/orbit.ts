const DEG2RAD = Math.PI / 180;
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

export interface PreparedKeplerian {
  /**
   * Returns heliocentric ecliptic J2000 coordinates (AU) for the supplied Julian day.
   * When the orbit configuration is degenerate the method yields null.
   */
  propagate(jd: number): [number, number, number] | null;
  /**
   * For elliptic orbits, returns the Cartesian coordinates for a given true anomaly.
   * Hyperbolic solutions return null.
   */
  positionAtTrueAnomaly?(nu: number): [number, number, number] | null;
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

export function prepareKeplerian(els: Keplerian): PreparedKeplerian {
  const invalid: PreparedKeplerian = {
    propagate: () => null,
    positionAtTrueAnomaly: () => null,
  };

  if (!Number.isFinite(els.a) || !Number.isFinite(els.e)) {
    return invalid;
  }

  const cO = Math.cos(els.Omega);
  const sO = Math.sin(els.Omega);
  const ci = Math.cos(els.i);
  const si = Math.sin(els.i);
  const cw = Math.cos(els.omega);
  const sw = Math.sin(els.omega);

  if (![cO, sO, ci, si, cw, sw].every(Number.isFinite)) {
    return invalid;
  }

  const rot00 = cO * cw - sO * sw * ci;
  const rot01 = -cO * sw - sO * cw * ci;
  const rot10 = sO * cw + cO * sw * ci;
  const rot11 = -sO * sw + cO * cw * ci;
  const rot20 = -si * sw;
  const rot21 = si * cw;

  const rotate = (xp: number, yp: number): [number, number, number] | null => {
    const x = rot00 * xp + rot01 * yp;
    const y = rot10 * xp + rot11 * yp;
    const z = rot20 * xp + rot21 * yp;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }
    return [x, y, z];
  };

  const e = els.e;
  if (e < 1) {
    if (!(els.a > 0)) {
      return invalid;
    }
    const motion = K / Math.sqrt(els.a * els.a * els.a);
    if (!Number.isFinite(motion)) {
      return invalid;
    }
    const oneMinusESq = 1 - e * e;
    if (!(oneMinusESq > 0)) {
      return invalid;
    }
    const s = Math.sqrt(oneMinusESq);
    const propagateElliptic = (jd: number): [number, number, number] | null => {
      const dt = jd - els.epochJD;
      const mean = wrapPi(els.M + motion * dt);
      const eccentric = solveElliptic(mean, e);
      const cosE = Math.cos(eccentric);
      const sinE = Math.sin(eccentric);
      const denom = 1 - e * cosE;
      if (Math.abs(denom) < 1e-12) {
        return null;
      }
      const radius = els.a * denom;
      const cosv = (cosE - e) / denom;
      const sinv = (s * sinE) / denom;
      return rotate(radius * cosv, radius * sinv);
    };

    const positionAtTrueAnomaly = (nu: number): [number, number, number] | null => {
      const denom = 1 + e * Math.cos(nu);
      if (Math.abs(denom) < 1e-12) {
        return null;
      }
      const r = (els.a * oneMinusESq) / denom;
      const xp = r * Math.cos(nu);
      const yp = r * Math.sin(nu);
      return rotate(xp, yp);
    };

    return { propagate: propagateElliptic, positionAtTrueAnomaly };
  }

  const aAbs = Math.abs(els.a);
  if (!(aAbs > 0)) {
    return invalid;
  }
  const motion = K / Math.sqrt(aAbs * aAbs * aAbs);
  if (!Number.isFinite(motion)) {
    return invalid;
  }
  const s = Math.sqrt(Math.max(e * e - 1, 0));

  const propagateHyperbolic = (jd: number): [number, number, number] | null => {
    const dt = jd - els.epochJD;
    const mean = els.M + motion * dt;
    const hyper = solveHyperbolic(mean, e);
    const ch = Math.cosh(hyper);
    const sh = Math.sinh(hyper);
    const denom = e * ch - 1;
    if (Math.abs(denom) < 1e-12) {
      return null;
    }
    const radius = aAbs * denom;
    const cosv = (e - ch) / denom;
    const sinv = (s * sh) / denom;
    return rotate(radius * cosv, radius * sinv);
  };

  return { propagate: propagateHyperbolic };
}

export function propagate(els: Keplerian, jd: number): [number, number, number] {
  const e = els.e;
  const incl = els.i;
  const asc = els.Omega;
  const arg = els.omega;
  const dt = jd - els.epochJD;

  let xp = 0;
  let yp = 0;

  if (e < 1) {
    const a = els.a;
    const motion = K / Math.sqrt(a * a * a);
    const mean = wrapPi(els.M + motion * dt);
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
    const mean = els.M + motion * dt;
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

function degToRad(value: number): number {
  return value * DEG2RAD;
}

export function earthElementsApprox(epochJD = 2451545.0): Keplerian {
  return {
    a: 1.00000261,
    e: 0.01671123,
    i: degToRad(0.00005),
    Omega: degToRad(-11.26064),
    omega: degToRad(102.94719),
    M: degToRad(100.46435),
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
  const i = degToRad(Number(orbit.i));
  const Omega = degToRad(Number(orbit.om));
  const omega = degToRad(Number(orbit.w));
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

  return { a, e, i, Omega, omega, M: degToRad(Mdeg), epochJD };
}

export const _internal = {
  degToRad,
};
