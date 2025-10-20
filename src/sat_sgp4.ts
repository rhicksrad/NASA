import {
  eciToGeodetic,
  gstime,
  propagate,
  twoline2satrec,
} from 'https://cdn.jsdelivr.net/npm/satellite.js@5.0.1/dist/satellite.esm.js';

export type SatRec = ReturnType<typeof twoline2satrec>;

export const EARTH_RADIUS_KM = 6378.137;

export interface PropagationResult {
  position: [number, number, number];
  velocity: [number, number, number];
}

export interface GeodeticResult {
  longitude: number;
  latitude: number;
  altitude: number;
}

export function tleToSatrec(line1: string, line2: string): SatRec {
  return twoline2satrec(line1.trim(), line2.trim());
}

export function propEciKm(satrec: SatRec, date: Date): PropagationResult | null {
  const result = propagate(satrec, date);
  if (!result.position || !result.velocity) {
    return null;
  }
  const { x, y, z } = result.position;
  const { x: vx, y: vy, z: vz } = result.velocity;
  if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(vx) || !isFinite(vy) || !isFinite(vz)) {
    return null;
  }
  return {
    position: [x, y, z],
    velocity: [vx, vy, vz],
  };
}

export function eciToLngLatAlt(date: Date, eciKm: [number, number, number]): GeodeticResult {
  const gmst = gstime(date);
  const geo = eciToGeodetic({ x: eciKm[0], y: eciKm[1], z: eciKm[2] }, gmst);
  const deg = (rad: number): number => (rad * 180) / Math.PI;
  return {
    longitude: deg(geo.longitude),
    latitude: deg(geo.latitude),
    altitude: geo.height,
  };
}

export function tleAgeDays(epochDate: Date, now: Date): number {
  const diff = now.getTime() - epochDate.getTime();
  return diff / (1000 * 60 * 60 * 24);
}

export function gmstFromDate(date: Date): number {
  const gmst = gstime(date);
  const twoPi = Math.PI * 2;
  return ((gmst % twoPi) + twoPi) % twoPi;
}

export function normalizeLongitude(lon: number): number {
  let normalized = lon;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}
