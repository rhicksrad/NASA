import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { jdFromDate, propagate, type Keplerian } from '../utils/orbit';

const SCALE = 120;
const DAY_MS = 86_400_000;

const isFinite3 = (v: readonly number[]): boolean => v.length === 3 && v.every(Number.isFinite);

interface OrbitConfig {
  color: number;
  segments?: number;
  spanDays?: number;
}

export interface OrbitSample {
  posAU: [number, number, number];
  velAUPerDay?: [number, number, number];
}

export interface SmallBodySpec {
  name: string;
  els?: Keplerian;
  color: number;
  sample?: (date: Date) => OrbitSample | null;
  orbit?: OrbitConfig;
  label?: string;
}

export interface PlanetSampleProvider {
  name: string;
  color: number;
  radius?: number;
  getPosition(date: Date): [number, number, number] | null;
  orbitRadius?: number;
}

export interface Neo3DOptions {
  host: HTMLElement;
  dateLabel?: HTMLElement | null;
  initialDate?: Date;
  minDate?: Date;
  maxDate?: Date;
}

interface RenderBody {
  spec: SmallBodySpec;
  mesh: THREE.Mesh;
  orbitLine?: THREE.Line;
}

interface PlanetNode {
  provider: PlanetSampleProvider;
  mesh: THREE.Mesh;
  orbitLine?: THREE.Line;
}

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
  return parts.map(v => v.toPrecision(12)).join('|');
}

function toScene(pos: [number, number, number]): THREE.Vector3 {
  const [x, y, z] = pos;
  return new THREE.Vector3(x * SCALE, z * SCALE, y * SCALE);
}

function buildOrbitPoints(els: Keplerian, segments: number, spanDays?: number): Float32Array {
  const key = orbitKey(els, segments, spanDays);
  const cached = orbitCache.get(key);
  if (cached) {
    return cached;
  }
  const points: number[] = [];
  if (els.e < 1) {
    const aAbs = Math.abs(els.a);
    const period = 2 * Math.PI * Math.sqrt(aAbs * aAbs * aAbs) / 0.01720209895;
    for (let i = 0; i <= segments; i += 1) {
      const jd = els.epochJD + (period * i) / segments;
      const pos = propagate(els, jd);
      if (!isFinite3(pos)) {
        continue;
      }
      const [x, y, z] = pos;
      points.push(x * SCALE, z * SCALE, y * SCALE);
    }
  } else {
    const span = spanDays ?? 2200;
    const half = span / 2;
    for (let i = 0; i <= segments; i += 1) {
      const offset = -half + (span * i) / segments;
      const pos = propagate(els, els.epochJD + offset);
      if (!isFinite3(pos)) {
        continue;
      }
      const [x, y, z] = pos;
      points.push(x * SCALE, z * SCALE, y * SCALE);
    }
  }
  const array = new Float32Array(points);
  orbitCache.set(key, array);
  return array;
}

function makeOrbitLine(points: Float32Array, color: number, closed: boolean): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 });
  return closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
}

function createPlanetMesh(color: number, radius = 0.02): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(radius * SCALE, 48);
  const material = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function createBodyMesh(color: number): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(0.012 * SCALE, 32);
  const material = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export class Neo3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private simMs: number;
  private secondsPerSecond = 86_400;
  private paused = false;
  private bodies: RenderBody[] = [];
  private planets = new Map<string, PlanetNode>();
  private minMs: number;
  private maxMs: number;
  private ready = false;
  private hasData = false;
  private hasFinitePositions = false;

  constructor(private options: Neo3DOptions) {
    const { host } = options;
    const width = host.clientWidth || 800;
    const height = host.clientHeight || 520;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x020412, 1);
    host.replaceChildren(this.renderer.domElement);
    this.renderer.domElement.style.visibility = 'hidden';

    this.camera = new THREE.PerspectiveCamera(52, width / height, 0.01, 1000 * SCALE);
    this.camera.position.set(0, 6 * SCALE, 6 * SCALE);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 0.4 * SCALE;
    this.controls.maxDistance = 30 * SCALE;

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const sunLight = new THREE.PointLight(0xfff5c0, 2.6, 0, 2);
    sunLight.position.set(0, 0, 0);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(0.06 * SCALE, 48), new THREE.MeshBasicMaterial({ color: 0xfff1a8 }));
    sun.rotation.x = -Math.PI / 2;
    this.scene.add(ambient, sunLight, sun);

    this.simMs = (options.initialDate ?? new Date()).getTime();
    this.minMs = options.minDate?.getTime() ?? Number.NEGATIVE_INFINITY;
    this.maxMs = options.maxDate?.getTime() ?? Number.POSITIVE_INFINITY;

    window.addEventListener('resize', () => this.onResize());
  }

  setDate(date: Date): void {
    this.simMs = THREE.MathUtils.clamp(date.getTime(), this.minMs, this.maxMs);
  }

  getCurrentDate(): Date {
    return new Date(this.simMs);
  }

  setTimeScale(secondsPerSecond: number): void {
    this.secondsPerSecond = secondsPerSecond;
  }

  setPaused(next: boolean): void {
    this.paused = next;
    if (!next) {
      this.clock.stop();
      this.clock.start();
    }
  }

  addSmallBodies(bodies: SmallBodySpec[]): void {
    for (const spec of bodies) {
      const mesh = createBodyMesh(spec.color);
      mesh.visible = false;
      this.scene.add(mesh);
      let orbitLine: THREE.Line | undefined;
      if (spec.orbit) {
        const segments = Math.max(32, spec.orbit.segments ?? 512);
        let points: Float32Array | null = null;
        if (spec.els) {
          points = buildOrbitPoints(spec.els, segments, spec.orbit.spanDays);
        } else if (spec.sample) {
          points = this.buildSampleOrbitPoints(spec, segments, spec.orbit.spanDays);
        }
        if (points && points.length >= 6) {
          const closed = spec.els ? spec.els.e < 1 : false;
          orbitLine = makeOrbitLine(points, spec.orbit.color, closed);
          orbitLine.renderOrder = 1;
          this.scene.add(orbitLine);
        }
      }
      this.bodies.push({ spec, mesh, orbitLine });
    }
    this.hasData = this.bodies.length > 0;
    if (!this.hasData) {
      this.hasFinitePositions = false;
    }
    this.updateReadyState();
  }

  clearSmallBodies(): void {
    for (const body of this.bodies) {
      this.scene.remove(body.mesh);
      if (body.orbitLine) this.scene.remove(body.orbitLine);
    }
    this.bodies = [];
    this.hasData = false;
    this.hasFinitePositions = false;
    this.updateReadyState();
  }

  setPlanets(providers: PlanetSampleProvider[]): void {
    for (const existing of this.planets.values()) {
      this.scene.remove(existing.mesh);
      if (existing.orbitLine) this.scene.remove(existing.orbitLine);
    }
    this.planets.clear();

    for (const provider of providers) {
      const mesh = createPlanetMesh(provider.color, provider.radius ?? 0.03);
      this.scene.add(mesh);
      let orbitLine: THREE.Line | undefined;
      const orbitRadius = provider.orbitRadius;
      if (typeof orbitRadius === 'number' && Number.isFinite(orbitRadius) && orbitRadius > 0) {
        const geometry = new THREE.CircleGeometry(orbitRadius * SCALE, 256);
        geometry.rotateX(-Math.PI / 2);
        const material = new THREE.LineBasicMaterial({ color: provider.color, transparent: true, opacity: 0.2 });
        orbitLine = new THREE.LineLoop(geometry, material);
        orbitLine.renderOrder = 0;
        this.scene.add(orbitLine);
      }
      mesh.visible = false;
      if (orbitLine) {
        orbitLine.visible = false;
      }
      this.planets.set(provider.name, { provider, mesh, orbitLine });
    }
  }

  start(): void {
    this.clock.start();
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = this.clock.getDelta();
      if (!this.paused) {
        this.simMs += dt * 1000 * this.secondsPerSecond;
        this.simMs = THREE.MathUtils.clamp(this.simMs, this.minMs, this.maxMs);
      }
      this.renderFrame(new Date(this.simMs));
    };
    loop();
  }

  private updateReadyState(): void {
    const nextReady = this.hasData && this.hasFinitePositions;
    if (nextReady !== this.ready) {
      this.ready = nextReady;
      this.renderer.domElement.style.visibility = nextReady ? 'visible' : 'hidden';
    }
  }

  private renderFrame(now: Date): void {
    const jd = jdFromDate(now);
    if (this.options.dateLabel) {
      this.options.dateLabel.textContent = now.toISOString().replace('T', ' ').slice(0, 19);
    }

    for (const node of this.planets.values()) {
      const position = node.provider.getPosition(now);
      if (position && isFinite3(position)) {
        node.mesh.visible = true;
        if (node.orbitLine) node.orbitLine.visible = true;
        node.mesh.position.copy(toScene(position as [number, number, number]));
      } else {
        node.mesh.visible = false;
        if (node.orbitLine) node.orbitLine.visible = false;
      }
    }

    let finitePositions = this.bodies.length > 0;
    for (const body of this.bodies) {
      let pos: [number, number, number] | null = null;
      if (body.spec.sample) {
        const sample = body.spec.sample(now);
        if (sample && isFinite3(sample.posAU)) {
          pos = sample.posAU;
        }
      } else if (body.spec.els) {
        const propagated = propagate(body.spec.els, jd);
        if (isFinite3(propagated)) {
          pos = [propagated[0], propagated[1], propagated[2]];
        }
      }

      if (!pos) {
        finitePositions = false;
        body.mesh.visible = false;
        if (body.orbitLine) {
          body.orbitLine.visible = false;
        }
        continue;
      }
      const vec = toScene([pos[0], pos[1], pos[2]]);
      body.mesh.visible = true;
      if (body.orbitLine) {
        body.orbitLine.visible = true;
      }
      body.mesh.position.copy(vec);
    }

    this.hasData = this.bodies.length > 0;
    this.hasFinitePositions = finitePositions;
    this.updateReadyState();
    if (!this.ready) {
      for (const body of this.bodies) {
        body.mesh.visible = false;
        if (body.orbitLine) {
          body.orbitLine.visible = false;
        }
      }
      this.renderer.clear();
      return;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private buildSampleOrbitPoints(spec: SmallBodySpec, segments: number, spanDays?: number): Float32Array | null {
    if (!spec.sample) {
      return null;
    }
    const span = spanDays ?? 2200;
    const half = span / 2;
    const points: number[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const offsetDays = -half + (span * i) / segments;
      const sampleDate = new Date(this.simMs + offsetDays * DAY_MS);
      const state = spec.sample(sampleDate);
      if (!state || !isFinite3(state.posAU)) {
        continue;
      }
      const [x, y, z] = state.posAU;
      points.push(x * SCALE, z * SCALE, y * SCALE);
    }
    return points.length >= 6 ? new Float32Array(points) : null;
  }

  private onResize(): void {
    const { host } = this.options;
    const width = host.clientWidth || 800;
    const height = host.clientHeight || 520;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}

export const _internal = { buildOrbitPoints };
