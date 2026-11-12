/** Pure orbit helpers for the Satellite 3D page: attitude, orbit sampling, equator crossings, trails. */
import * as THREE from 'three';
import { KM_TO_UNITS } from './earthScene';
import { eciToLngLatAlt, normalizeLongitude, propEciKm, type SatRec } from './sgp4';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

const ORBIT_SAMPLE_COUNT = 192;
const ORBIT_SPAN_MINUTES = 96;
const TRAIL_CAPACITY = 180;

const forward = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const basis = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();

const usable = (v: THREE.Vector3): boolean => Number.isFinite(v.lengthSq()) && v.lengthSq() >= 1e-8;

export function toSceneUnits(positionKm: Vec3): Vec3 {
  return [positionKm[0] * KM_TO_UNITS, positionKm[1] * KM_TO_UNITS, positionKm[2] * KM_TO_UNITS];
}

/** Attitude with the model's nose along the velocity vector and its top facing away from Earth. */
export function orientationFor(positionKm: Vec3, velocityKm: Vec3): Quat | null {
  forward.set(...velocityKm);
  if (!usable(forward)) return null;
  forward.normalize();

  up.set(...positionKm);
  if (usable(up)) up.normalize();
  else up.set(0, 0, 1);
  if (Math.abs(forward.dot(up)) > 0.95) up.set(0, 0, 1);

  right.copy(forward).cross(up);
  if (!usable(right)) return null;
  right.normalize();
  up.copy(right).cross(forward).normalize();

  quaternion.setFromRotationMatrix(basis.makeBasis(right, up, forward));
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

/** Samples roughly one low-Earth-orbit revolution centred on `date`, as packed xyz scene units. */
export function sampleOrbit(satrec: SatRec, date: Date): Float32Array | null {
  const spanMs = ORBIT_SPAN_MINUTES * 60_000;
  const startMs = date.getTime() - spanMs / 2;
  const stepMs = spanMs / (ORBIT_SAMPLE_COUNT - 1);
  const positions = new Float32Array(ORBIT_SAMPLE_COUNT * 3);
  let count = 0;
  for (let i = 0; i < ORBIT_SAMPLE_COUNT; i += 1) {
    const state = propEciKm(satrec, new Date(startMs + stepMs * i));
    if (!state) continue;
    positions.set(toSceneUnits(state.position), count * 3);
    count += 1;
  }
  if (count < 2) return null;
  return count < ORBIT_SAMPLE_COUNT ? positions.slice(0, count * 3) : positions;
}

export interface EquatorCrossing {
  timeMs: number;
  longitude: number;
}

/** Finds the next time the ground track crosses the equator, searching up to six hours ahead. */
export function findNextEquatorCrossing(satrec: SatRec, startMs: number): EquatorCrossing | null {
  const STEP_MS = 60_000;
  const MAX_STEPS = 360;

  const groundPoint = (timeMs: number) => {
    const date = new Date(timeMs);
    const state = propEciKm(satrec, date);
    return state ? eciToLngLatAlt(date, state.position) : null;
  };

  let previous: { timeMs: number; latitude: number } | null = null;
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const timeMs = startMs + STEP_MS * step;
    const point = groundPoint(timeMs);
    if (!point) continue;
    if (previous && Math.sign(previous.latitude) !== Math.sign(point.latitude)) {
      let low = previous.timeMs;
      let high = timeMs;
      let lowLatitude = previous.latitude;
      for (let iteration = 0; iteration < 8; iteration += 1) {
        const mid = (low + high) / 2;
        const midPoint = groundPoint(mid);
        if (!midPoint) break;
        if (Math.sign(midPoint.latitude) === Math.sign(lowLatitude)) {
          low = mid;
          lowLatitude = midPoint.latitude;
        } else {
          high = mid;
        }
      }
      const crossingMs = (low + high) / 2;
      const crossing = groundPoint(crossingMs);
      return crossing ? { timeMs: crossingMs, longitude: normalizeLongitude(crossing.longitude) } : null;
    }
    previous = { timeMs, latitude: point.latitude };
  }
  return null;
}

/** Fixed-size ring buffer of recent positions, unrolled oldest-first for drawing. */
export class TrailBuffer {
  private readonly ring = new Float32Array(TRAIL_CAPACITY * 3);
  private readonly ordered = new Float32Array(TRAIL_CAPACITY * 3);
  private head = 0;
  private size = 0;

  get count(): number {
    return this.size;
  }

  push(position: Vec3): void {
    this.ring.set(position, this.head * 3);
    this.head = (this.head + 1) % TRAIL_CAPACITY;
    this.size = Math.min(this.size + 1, TRAIL_CAPACITY);
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }

  /** Positions oldest-first. The returned array is reused between calls. */
  positions(): Float32Array {
    for (let i = 0; i < this.size; i += 1) {
      const source = (this.head + TRAIL_CAPACITY - this.size + i) % TRAIL_CAPACITY;
      this.ordered.set(this.ring.subarray(source * 3, source * 3 + 3), i * 3);
    }
    return this.ordered;
  }
}
