/** Shared constants and body descriptions for the NEO 3D scene. */
import * as THREE from 'three';
import type { Keplerian } from '../../../orbits/kepler';

/** Scene units per astronomical unit. */
export const SCALE = 120;
/** Bodies are drawn far larger than life so they stay visible at solar-system scale. */
export const SIZE_MULTIPLIER = 2;
export const SMALL_BODY_SCALE = 3;

export type Vec3 = [number, number, number];
export type SmallBodyShape = 'comet' | 'asteroid';

export interface OrbitConfig {
  color: number;
  segments?: number;
  spanDays?: number;
}

export interface OrbitSample {
  posAU: [number, number, number];
  velAUPerDay?: [number, number, number];
}

export interface SmallBodySpec {
  id?: string;
  name: string;
  color: number;
  els?: Keplerian;
  sample?: (date: Date) => OrbitSample | null;
  orbit?: OrbitConfig;
  label?: string;
  absMag?: number;
  diameterKm?: number;
  bodyType?: string;
  orbitClass?: string;
  kindHint?: string;
  isPlanet?: boolean;
}

export interface PlanetSampleProvider {
  name: string;
  color: number;
  radius?: number;
  getPosition(date: Date): [number, number, number] | null;
  orbitRadius?: number;
  diameterKm?: number;
  absMag?: number;
  kindHint?: string;
}

/** Converts heliocentric ecliptic AU (Z-up) to scene units (Y-up). */
export function toScene(pos: [number, number, number]): THREE.Vector3 {
  const [x, y, z] = pos;
  return new THREE.Vector3(x * SCALE, z * SCALE, y * SCALE);
}

export function isFiniteVec3(value: readonly number[] | null | undefined): value is Vec3 {
  return !!value && value.length === 3 && value.every(Number.isFinite);
}
