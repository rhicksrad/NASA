// Minimal Kepler propagator using standard elements at J2000 epoch.
// Elements expected from NeoWs: a (AU), e, i, ascending_node_longitude (Ω, deg),
// perihelion_argument (ω, deg), mean_anomaly (M, deg), epoch_osculation (JD).
// Returns heliocentric ecliptic J2000 position in AU.

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;
// Gaussian gravitational constant k in AU^(3/2)/day for Solar System barycentric two-body
const K = 0.01720209895; // sqrt(GM_sun) in AU^(3/2)/day

export interface Keplerian {
  a: number; // AU
  e: number;
  i: number; // deg
  Omega: number; // deg
  omega: number; // deg
  M: number; // deg
  epochJD: number; // Julian day
}

export function jdFromDate(d: Date): number {
  // UTC to JD
  const t = d.getTime(); // ms since 1970-01-01
  return t / 86400000 + 2440587.5;
}

function solveKepler(M: number, e: number): number {
  // M in rad, return E in rad. Newton-Raphson.
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 15; k++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const dE = -f / fp;
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

export function propagate(els: Keplerian, jd: number): [number, number, number] {
  const a = els.a;
  const e = els.e;
  const i = els.i * DEG;
  const Omega = els.Omega * DEG;
  const omega = els.omega * DEG;
  // Mean motion n = k / a^(3/2) in rad/day
  const n = K / Math.sqrt(a * a * a);
  const M0 = els.M * DEG;
  const dt = jd - els.epochJD; // days from epoch
  let M = M0 + n * dt;
  // wrap to [-pi, pi]
  M = ((M + Math.PI) % TWO_PI) - Math.PI;

  const E = solveKepler(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);

  // Distance and true anomaly
  const r = a * (1 - e * cosE);
  const nu = Math.atan2(Math.sqrt(1 - e * e) * sinE, cosE - e);

  // Position in orbital plane
  const x_p = r * Math.cos(nu);
  const y_p = r * Math.sin(nu);

  // Rotate: perifocal -> ecliptic J2000
  const cosO = Math.cos(Omega), sinO = Math.sin(Omega);
  const cosi = Math.cos(i), sini = Math.sin(i);
  const cosw = Math.cos(omega), sinw = Math.sin(omega);

  const X = (cosO * cosw - sinO * sinw * cosi) * x_p + (-cosO * sinw - sinO * cosw * cosi) * y_p;
  const Y = (sinO * cosw + cosO * sinw * cosi) * x_p + (-sinO * sinw + cosO * cosw * cosi) * y_p;
  const Z = (sini * sinw) * x_p + (sini * cosw) * y_p; // derived from rotation matrix

  return [X, Y, Z]; // AU
}

// Convenience for Earth using simple mean elements near J2000.
// Good enough for visualization.
export function earthElementsApprox(jdEpoch = 2451545.0): Keplerian {
  return {
    a: 1.00000261,
    e: 0.01671123,
    i: 0.00005,
    Omega: -11.26064,  // longitude of ascending node
    omega: 102.94719,  // argument of perihelion
    M: 100.46435,      // mean anomaly at J2000
    epochJD: jdEpoch
  };
}
