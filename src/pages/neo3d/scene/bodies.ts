/** Meshes and orbit lines for planets, asteroids and comets. */
import * as THREE from 'three';
import { propagate, type Keplerian, type PreparedKeplerian } from '../../../orbits/kepler';
import { createPlanetMaterial, createSaturnRings, createSmallBodyTexture } from './textures';
import {
  SCALE,
  SIZE_MULTIPLIER,
  SMALL_BODY_SCALE,
  isFiniteVec3,
  type PlanetSampleProvider,
  type SmallBodySpec,
} from './types';

const DAY_MS = 86_400_000;
const TWO_PI = Math.PI * 2;

const orbitCache = new Map<string, Float32Array>();

function orbitKey(els: Keplerian, segments: number, spanDays?: number): string {
  const parts = [
    segments,
    spanDays ?? 0,
    els.a,
    els.e,
    els.i,
    els.Omega,
    els.omega,
    els.M,
    els.epochJD,
  ];
  return parts.map((value) => value.toPrecision(12)).join('|');
}

function rotatePerifocal(
  els: Keplerian,
  xp: number,
  yp: number,
): [number, number, number] {
  const cO = Math.cos(els.Omega);
  const sO = Math.sin(els.Omega);
  const ci = Math.cos(els.i);
  const si = Math.sin(els.i);
  const cw = Math.cos(els.omega);
  const sw = Math.sin(els.omega);

  const x = (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp;
  const y = (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp;
  const z = si * (-sw * xp + cw * yp);

  return [x, y, z];
}

function ellipsePoint(els: Keplerian, nu: number): [number, number, number] | null {
  const { a, e } = els;
  if (!(Number.isFinite(a) && a > 0)) return null;
  const oneMinusESq = 1 - e * e;
  if (!(oneMinusESq > 0)) return null;

  const denom = 1 + e * Math.cos(nu);
  if (Math.abs(denom) < 1e-12) return null;

  const r = (a * oneMinusESq) / denom;
  const xp = r * Math.cos(nu);
  const yp = r * Math.sin(nu);
  return rotatePerifocal(els, xp, yp);
}

export function buildOrbitPoints(
  els: Keplerian,
  segments: number,
  spanDays?: number,
  prepared?: PreparedKeplerian,
): Float32Array {
  const key = orbitKey(els, segments, spanDays);
  const cached = orbitCache.get(key);
  if (cached) return cached;

  const points: number[] = [];
  if (els.e < 1) {
    const ellipsePosition = prepared?.positionAtTrueAnomaly;
    for (let i = 0; i <= segments; i += 1) {
      const nu = (i / segments) * TWO_PI;
      const pos = ellipsePosition ? ellipsePosition(nu) : ellipsePoint(els, nu);
      if (!pos || !isFiniteVec3(pos)) continue;
      const [x, y, z] = pos;
      points.push(x * SCALE, z * SCALE, y * SCALE);
    }
  } else {
    const span = spanDays ?? 2600;
    const half = span / 2;
    const propagateOrbit = prepared?.propagate;
    for (let i = 0; i <= segments; i += 1) {
      const offset = -half + (span * i) / segments;
      const pos = propagateOrbit?.(els.epochJD + offset) ?? propagate(els, els.epochJD + offset);
      if (!isFiniteVec3(pos)) continue;
      const [x, y, z] = pos;
      points.push(x * SCALE, z * SCALE, y * SCALE);
    }
  }

  const array = new Float32Array(points);
  orbitCache.set(key, array);
  return array;
}

export function buildSampleOrbitPoints(
  spec: SmallBodySpec,
  segments: number,
  spanDays: number | undefined,
  centerMs: number,
): Float32Array | null {
  if (!spec.sample) return null;
  const span = spanDays ?? 2600;
  const half = span / 2;
  const points: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const offsetDays = -half + (span * i) / segments;
    const sampleDate = new Date(centerMs + offsetDays * DAY_MS);
    const state = spec.sample(sampleDate);
    if (!state || !isFiniteVec3(state.posAU)) continue;
    const [x, y, z] = state.posAU;
    points.push(x * SCALE, z * SCALE, y * SCALE);
  }
  return points.length >= 6 ? new Float32Array(points) : null;
}

export function makeOrbitLine(points: Float32Array, color: number, closed: boolean): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.26 });
  return closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
}

export function createPlanetMesh(
  provider: PlanetSampleProvider,
): { mesh: THREE.Mesh; extras: THREE.Object3D[] } {
  const radius = provider.radius ?? 0.03;
  const geometry = new THREE.SphereGeometry(radius * SIZE_MULTIPLIER * SCALE, 96, 64);
  const material = createPlanetMaterial(provider.name, provider.color);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const extras: THREE.Object3D[] = [];
  if (provider.name.trim().toLowerCase() === 'saturn') {
    const rings = createSaturnRings(radius);
    if (rings) {
      rings.visible = false;
      extras.push(rings);
    }
  }

  return { mesh, extras };
}

export function inferSmallBodyShape(spec: SmallBodySpec): 'comet' | 'asteroid' {
  const hint = [spec.kindHint, spec.bodyType, spec.orbitClass]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (hint.includes('comet')) return 'comet';
  return 'asteroid';
}

function createAsteroidGeometry(size: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(size * 0.9, 1);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < positions.count; i += 1) {
    vertex.fromBufferAttribute(positions, i);
    const wobble =
      1 +
      0.18 *
        (Math.sin(vertex.x * 8.3) + Math.sin(vertex.y * 11.7) + Math.sin(vertex.z * 9.9)) /
          3;
    vertex.multiplyScalar(wobble);
    vertex.y *= 0.9;
    positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createCometGeometry(size: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(size * 0.7, 2);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < positions.count; i += 1) {
    vertex.fromBufferAttribute(positions, i);
    const tailFactor = THREE.MathUtils.clamp(vertex.z / (size * 0.7), -1.2, 1.2);
    const taper = 1 - Math.max(0, tailFactor) * 0.25;
    const stretch = 1 + Math.max(0, tailFactor) * 1.6;
    vertex.x *= taper * 0.85;
    vertex.y *= taper * 0.85;
    vertex.z *= stretch;
    positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  positions.needsUpdate = true;
  geometry.translate(0, 0, -size * 0.18);
  geometry.computeVertexNormals();
  return geometry;
}

export function createBodyMesh(spec: SmallBodySpec): THREE.Mesh {
  const baseSize = 0.008 * SIZE_MULTIPLIER * SCALE;
  const size = baseSize * SMALL_BODY_SCALE;
  const shape = inferSmallBodyShape(spec);
  const geometry =
    shape === 'comet' ? createCometGeometry(size) : createAsteroidGeometry(size * 0.95);

  const materialOptions: THREE.MeshStandardMaterialParameters = {
    color: spec.color,
    metalness: shape === 'comet' ? 0.08 : 0.22,
    roughness: shape === 'comet' ? 0.78 : 0.58,
  };

  const texture = createSmallBodyTexture(spec, shape);
  if (texture) {
    materialOptions.map = texture;
  }

  if (shape === 'asteroid') {
    materialOptions.flatShading = true;
  } else {
    const emissive = new THREE.Color(spec.color).multiplyScalar(0.15);
    materialOptions.emissive = emissive;
    materialOptions.emissiveIntensity = 0.35;
  }

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(materialOptions));
  if (shape === 'comet') {
    mesh.rotation.x = Math.PI / 2;
    mesh.userData.tailAxis = new THREE.Vector3(0, 0, 1);
    mesh.userData.baseQuaternion = mesh.quaternion.clone();
  }
  mesh.userData.shape = shape;
  return mesh;
}

export function buildCirclePolyline(radiusAU: number, color: number, segments = 256, opacity = 0.5): THREE.LineLoop {
  const pts = new Float32Array((segments + 1) * 3);
  const r = radiusAU * SCALE;
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = r * Math.cos(angle);
    const z = r * Math.sin(angle);
    const idx = i * 3;
    pts[idx + 0] = x;
    pts[idx + 1] = 0;
    pts[idx + 2] = z;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  return new THREE.LineLoop(geom, mat);
}

export function createGridRing(): THREE.LineLoop {
  const ring = buildCirclePolyline(1, 0x1f2937, 320, 0.18);
  ring.renderOrder = 0;
  return ring;
}
