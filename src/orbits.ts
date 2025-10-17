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

  if (!(e > 0)) throw new Error('Conic propagation requires eccentricity > 0');

  if (e > 1 + 1e-12) {
    const aAbs = Number.isFinite(a) && a !== 0 ? Math.abs(a) : Number.isFinite(q) ? (q as number) / (e - 1) : Number.NaN;
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
    return perifocalToEcliptic(r, nu, e, aAbs, inc, Omega, omega);
  }

  if (Math.abs(e - 1) <= 1e-12) {
    const qp = Number.isFinite(q) ? (q as number) : Number.isFinite(a) ? a * (1 - e) : Number.NaN;
    if (!Number.isFinite(qp) || !Number.isFinite(tp_jd)) throw new Error('parabolic: missing q or tp');
    const D = solveBarker(tJD - (tp_jd as number), qp);
    const r = qp * (1 + D * D);
    const nu = 2 * Math.atan(D);
    return perifocalToEcliptic(r, nu, e, qp, inc, Omega, omega);
  }

  if (!(a > 0)) throw new Error('elliptic: a<=0');
  const n = Math.sqrt(MU / (a * a * a));
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
  const r = a * (1 - e * Math.cos(E));
  const nu = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2),
  );
  return perifocalToEcliptic(r, nu, e, a, inc, Omega, omega);
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
  if (!Number.isFinite(p) || p === 0) throw new Error('perifocal: invalid semilatus rectum');
  const h = Math.sqrt(MU * Math.abs(p));
  const rx = (-h / p) * Math.sin(nu);
  const ry = (h / p) * (e + Math.cos(nu));

  const vx = R11 * rx + R12 * ry;
  const vy = R21 * rx + R22 * ry;
  const vz = R31 * rx + R32 * ry;

  return {
    posAU: [x, y, z],
    velAUPerDay: [vx, vy, vz],
  };
}

export const _internal = { solveBarker, perifocalToEcliptic };
