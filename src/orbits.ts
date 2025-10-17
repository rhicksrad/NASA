// Gaussian gravitational constant: mu☉ = k^2 AU^3/day^2
const K = 0.01720209895;
const MU = K * K;

export interface ConicElements {
  a: number;
  e: number;
  inc: number;
  Omega: number;
  omega: number;
  epochJD?: number;
  M0?: number;
  tp_jd?: number;
  q?: number;
}

export function propagateConic(
  el: ConicElements,
  tJD: number,
): { posAU: [number, number, number]; velAUPerDay: [number, number, number] } {
  const { a, e, inc, Omega, omega, epochJD, M0, tp_jd, q } = el;

  const hyper = e > 1 + 1e-12;
  const para = Math.abs(e - 1) <= 1e-12;

  if (hyper) {
    const ah = Number.isFinite(a) && a !== 0 ? a : Number.isFinite(q) ? q / (e - 1) : Number.NaN;
    if (!Number.isFinite(ah)) throw new Error('hyperbolic: missing a/q');
    const n = Math.sqrt(MU / Math.abs(ah * ah * ah));
    const M = Number.isFinite(tp_jd)
      ? n * (tJD - (tp_jd as number))
      : Number.isFinite(M0) && Number.isFinite(epochJD)
        ? (M0 as number) + n * (tJD - (epochJD as number))
        : Number.NaN;
    if (!Number.isFinite(M)) throw new Error('hyperbolic: missing epoch');
    let H = Math.asinh(M / e);
    for (let k = 0; k < 50; k += 1) {
      const sH = Math.sinh(H);
      const cH = Math.cosh(H);
      const f = e * sH - H - M;
      const fp = e * cH - 1;
      const dH = -f / fp;
      H += dH;
      if (Math.abs(dH) < 1e-12) break;
    }
    const aU = ah;
    const r = aU * (e * Math.cosh(H) - 1);
    const nu = 2 * Math.atan2(Math.sqrt(e + 1) * Math.sinh(H / 2), Math.sqrt(e - 1) * Math.cosh(H / 2));
    return perifocalToEcliptic(r, nu, e, aU, inc, Omega, omega);
  }

  if (para) {
    const qp = Number.isFinite(q) ? (q as number) : Number.isFinite(a) ? (a as number) * (1 - e) : Number.NaN;
    if (!Number.isFinite(qp) || !Number.isFinite(tp_jd)) throw new Error('parabolic: missing q or tp');
    const D = solveBarker(tJD - (tp_jd as number), qp);
    const r = qp * (1 + D * D);
    const nu = 2 * Math.atan(D);
    return perifocalToEcliptic(r, nu, e, Number.POSITIVE_INFINITY, inc, Omega, omega);
  }

  const ae = a;
  if (!(ae > 0)) throw new Error('elliptic: a<=0');
  const n = Math.sqrt(MU / (ae * ae * ae));
  const M = Number.isFinite(epochJD) && Number.isFinite(M0)
    ? (M0 as number) + n * (tJD - (epochJD as number))
    : Number.NaN;
  if (!Number.isFinite(M)) throw new Error('elliptic: missing M0/epoch');
  let E = M;
  for (let k = 0; k < 50; k += 1) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const dE = -f / fp;
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  const r = ae * (1 - e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  return perifocalToEcliptic(r, nu, e, ae, inc, Omega, omega);
}

function solveBarker(dtDays: number, q: number): number {
  const B = dtDays * Math.sqrt(MU / (q * q * q));
  let D = Math.cbrt(B);
  for (let k = 0; k < 50; k += 1) {
    const f = D + (D * D * D) / 3 - B;
    const fp = 1 + D * D;
    const dD = -f / fp;
    D += dD;
    if (Math.abs(dD) < 1e-12) break;
  }
  return D;
}

function perifocalToEcliptic(
  r: number,
  nu: number,
  e: number,
  a: number,
  inc: number,
  Omega: number,
  omega: number,
): { posAU: [number, number, number]; velAUPerDay: [number, number, number] } {
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
  const R13 = sO * si;
  const R21 = sO * cw + cO * sw * ci;
  const R22 = -sO * sw + cO * cw * ci;
  const R23 = -cO * si;
  const R31 = sw * si;
  const R32 = cw * si;
  const R33 = ci;

  const x = R11 * xP + R12 * yP + R13 * 0;
  const y = R21 * xP + R22 * yP + R23 * 0;
  const z = R31 * xP + R32 * yP + R33 * 0;

  let vxP = 0;
  let vyP = 0;
  if (Number.isFinite(a) && a !== Number.POSITIVE_INFINITY) {
    const p = a * (1 - e * e);
    if (!Number.isFinite(p) || p === 0) throw new Error('perifocal: invalid semilatus rectum');
    const factor = Math.sqrt(MU / Math.abs(p));
    vxP = -factor * sinNu;
    vyP = factor * (e + cosNu);
  } else {
    const p = r * (1 + cosNu);
    if (!Number.isFinite(p) || p === 0) throw new Error('perifocal: invalid parabolic semilatus');
    const factor = Math.sqrt(MU / p);
    vxP = -factor * sinNu;
    vyP = factor * (1 + cosNu);
  }

  const vx = R11 * vxP + R12 * vyP + R13 * 0;
  const vy = R21 * vxP + R22 * vyP + R23 * 0;
  const vz = R31 * vxP + R32 * vyP + R33 * 0;

  return {
    posAU: [x, y, z],
    velAUPerDay: [vx, vy, vz],
  };
}

export const _internal = { solveBarker, perifocalToEcliptic };
