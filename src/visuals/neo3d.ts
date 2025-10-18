import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { jdFromDate, propagate, type Keplerian } from '../utils/orbit';

const SCALE = 120;
const DAY_MS = 86_400_000;

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
  color: number;
  els?: Keplerian;
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
  onDateChange?: (date: Date) => void;
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
  return parts.map((value) => value.toPrecision(12)).join('|');
}

function toScene(pos: [number, number, number]): THREE.Vector3 {
  const [x, y, z] = pos;
  return new THREE.Vector3(x * SCALE, z * SCALE, y * SCALE);
}

function buildOrbitPoints(els: Keplerian, segments: number, spanDays?: number): Float32Array {
  const key = orbitKey(els, segments, spanDays);
  const cached = orbitCache.get(key);
  if (cached) return cached;

  const points: number[] = [];
  if (els.e < 1) {
    const aAbs = Math.abs(els.a);
    const period = (2 * Math.PI * Math.sqrt(aAbs * aAbs * aAbs)) / 0.01720209895;
    for (let i = 0; i <= segments; i += 1) {
      const jd = els.epochJD + (period * i) / segments;
      const pos = propagate(els, jd);
      if (!isFiniteVec3(pos)) continue;
      const [x, y, z] = pos;
      points.push(x * SCALE, z * SCALE, y * SCALE);
    }
  } else {
    const span = spanDays ?? 2600;
    const half = span / 2;
    for (let i = 0; i <= segments; i += 1) {
      const offset = -half + (span * i) / segments;
      const pos = propagate(els, els.epochJD + offset);
      if (!isFiniteVec3(pos)) continue;
      const [x, y, z] = pos;
      points.push(x * SCALE, z * SCALE, y * SCALE);
    }
  }

  const array = new Float32Array(points);
  orbitCache.set(key, array);
  return array;
}

function buildSampleOrbitPoints(
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

function makeOrbitLine(points: Float32Array, color: number, closed: boolean): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 });
  return closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
}

function createPlanetMesh(color: number, radius = 0.02): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius * SCALE, 24, 16);
  const material = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.6 });
  return new THREE.Mesh(geometry, material);
}

function createBodyMesh(color: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.008 * SCALE, 16, 12);
  const material = new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.4 });
  return new THREE.Mesh(geometry, material);
}

function buildCirclePolyline(radiusAU: number, color: number, segments = 256): THREE.Line {
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
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.25 });
  return new THREE.LineLoop(geom, mat);
}

function createGridRing(): THREE.LineLoop {
  const ring = buildCirclePolyline(1, 0x1f2937, 320);
  ring.material.transparent = true;
  (ring.material as THREE.LineBasicMaterial).opacity = 0.18;
  ring.rotation.set(0, 0, 0);
  ring.renderOrder = 0;
  return ring;
}

function isFiniteVec3(value: readonly number[]): boolean {
  return value.length === 3 && value.every(Number.isFinite);
}

export class Neo3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private simMs: number;
  private secondsPerSecond = 1;
  private paused = true;
  private bodies: RenderBody[] = [];
  private planets = new Map<string, PlanetNode>();
  private minMs: number;
  private maxMs: number;
  private smallBodiesVisible = true;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerClient = { x: 0, y: 0 };
  private hasPointer = false;
  private tooltip: HTMLDivElement;
  private interactiveMeshes: THREE.Mesh[] = [];
  private hoveredMesh: THREE.Mesh | null = null;
  private projected = new THREE.Vector3();
  private pointerViewport = { x: 0, y: 0 };

  constructor(private readonly options: Neo3DOptions) {
    const { host } = options;
    const width = host.clientWidth || 800;
    const height = host.clientHeight || 520;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x020412, 1);
    host.replaceChildren(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.visibility = 'visible';

    this.camera = new THREE.PerspectiveCamera(52, width / height, 0.01, 2000 * SCALE);
    this.camera.position.set(6 * SCALE, 6 * SCALE, 10 * SCALE);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 0.98 * (Math.PI / 2);
    this.controls.minDistance = 0.3 * SCALE;
    this.controls.maxDistance = 40 * SCALE;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const sunLight = new THREE.PointLight(0xfff5c0, 2.4, 0, 2);
    sunLight.position.set(0, 0, 0);
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(0.06 * SCALE, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff1a8 }),
    );
    this.scene.add(ambient, sunLight, sun, createGridRing());

    this.simMs = (options.initialDate ?? new Date()).getTime();
    this.minMs = options.minDate?.getTime() ?? Number.NEGATIVE_INFINITY;
    this.maxMs = options.maxDate?.getTime() ?? Number.POSITIVE_INFINITY;

    if (typeof window !== 'undefined') {
      const computed = window.getComputedStyle(host);
      if (computed.position === 'static') {
        host.style.position = 'relative';
      }
    }

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'neo3d-tooltip';
    Object.assign(this.tooltip.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      pointerEvents: 'none',
      background: 'rgba(15, 23, 42, 0.85)',
      color: '#e2e8f0',
      padding: '4px 8px',
      borderRadius: '6px',
      fontSize: '12px',
      lineHeight: '16px',
      whiteSpace: 'nowrap',
      boxShadow: '0 6px 18px rgba(15, 23, 42, 0.35)',
      opacity: '0',
      transform: 'translate(-9999px, -9999px)',
      transition: 'opacity 0.12s ease',
      zIndex: '1000',
    });
    const tooltipParent = typeof document !== 'undefined' && document.body ? document.body : host;
    tooltipParent.appendChild(this.tooltip);

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);

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
    if (this.paused === next) return;
    this.paused = next;
    if (!next) {
      this.clock.stop();
      this.clock.start();
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  setBounds(minDate?: Date | null, maxDate?: Date | null): void {
    this.minMs = minDate ? minDate.getTime() : Number.NEGATIVE_INFINITY;
    this.maxMs = maxDate ? maxDate.getTime() : Number.POSITIVE_INFINITY;
    this.simMs = THREE.MathUtils.clamp(this.simMs, this.minMs, this.maxMs);
  }

  setPlanets(providers: PlanetSampleProvider[]): void {
    for (const planet of this.planets.values()) {
      this.scene.remove(planet.mesh);
      if (planet.orbitLine) this.scene.remove(planet.orbitLine);
    }
    this.planets.clear();

    for (const provider of providers) {
      const mesh = createPlanetMesh(provider.color, provider.radius ?? 0.03);
      mesh.visible = false;
      mesh.userData.hoverLabel = provider.name;
      this.scene.add(mesh);

      let orbitLine: THREE.Line | undefined;
      if (typeof provider.orbitRadius === 'number' && provider.orbitRadius > 0) {
        orbitLine = buildCirclePolyline(provider.orbitRadius, provider.color, 256);
        this.scene.add(orbitLine);
      }

      this.planets.set(provider.name, { provider, mesh, orbitLine });
    }

    this.refreshInteractiveMeshes();
  }

  setSmallBodies(bodies: SmallBodySpec[]): void {
    this.clearSmallBodies();
    this.addSmallBodies(bodies);
  }

  addSmallBodies(bodies: SmallBodySpec[]): void {
    for (const spec of bodies) {
      const mesh = createBodyMesh(spec.color);
      mesh.visible = false;
      mesh.userData.hoverLabel = spec.label ?? spec.name;
      this.scene.add(mesh);

      let orbitLine: THREE.Line | undefined;
      if (spec.orbit) {
        const segments = Math.max(64, spec.orbit.segments ?? 512);
        let points: Float32Array | null = null;
        if (spec.els) {
          points = buildOrbitPoints(spec.els, segments, spec.orbit.spanDays);
        } else if (spec.sample) {
          points = buildSampleOrbitPoints(spec, segments, spec.orbit.spanDays, this.simMs);
        }
        if (points && points.length >= 6) {
          const closed = spec.els ? spec.els.e < 1 : false;
          orbitLine = makeOrbitLine(points, spec.orbit.color, closed);
          orbitLine.visible = this.smallBodiesVisible;
          this.scene.add(orbitLine);
        }
      }

      this.bodies.push({ spec, mesh, orbitLine });
    }

    this.refreshInteractiveMeshes();
  }

  setSmallBodiesVisible(visible: boolean): void {
    this.smallBodiesVisible = visible;
    for (const body of this.bodies) {
      if (!visible) {
        body.mesh.visible = false;
      }
      if (body.orbitLine) {
        body.orbitLine.visible = visible;
      }
    }
  }

  clearSmallBodies(): void {
    for (const body of this.bodies) {
      this.scene.remove(body.mesh);
      if (body.orbitLine) this.scene.remove(body.orbitLine);
    }
    this.bodies = [];
    this.refreshInteractiveMeshes();
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

  private renderFrame(now: Date): void {
    const jd = jdFromDate(now);
    if (this.options.dateLabel) {
      this.options.dateLabel.textContent = now.toISOString().slice(0, 19).replace('T', ' ');
    }

    for (const node of this.planets.values()) {
      const position = node.provider.getPosition(now);
      if (position && isFiniteVec3(position)) {
        node.mesh.visible = true;
        node.mesh.position.copy(toScene(position));
        if (node.orbitLine) node.orbitLine.visible = true;
      } else {
        node.mesh.visible = false;
        if (node.orbitLine) node.orbitLine.visible = false;
      }
    }

    for (const body of this.bodies) {
      if (!this.smallBodiesVisible) {
        body.mesh.visible = false;
        if (body.orbitLine) body.orbitLine.visible = false;
        continue;
      }

      let pos: [number, number, number] | null = null;
      if (body.spec.els) {
        const propagated = propagate(body.spec.els, jd);
        if (isFiniteVec3(propagated)) pos = [propagated[0], propagated[1], propagated[2]];
      }
      if (!pos && body.spec.sample) {
        const state = body.spec.sample(now);
        if (state && isFiniteVec3(state.posAU)) pos = state.posAU;
      }

      if (!pos) {
        body.mesh.visible = false;
        if (body.orbitLine) body.orbitLine.visible = true;
        continue;
      }

      body.mesh.visible = true;
      body.mesh.position.copy(toScene(pos));
      if (body.orbitLine) body.orbitLine.visible = true;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateHover();

    if (this.options.onDateChange) {
      this.options.onDateChange(now);
    }
  }

  private onResize(): void {
    const { host } = this.options;
    const width = host.clientWidth || 800;
    const height = host.clientHeight || 520;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private refreshInteractiveMeshes(): void {
    const meshes: THREE.Mesh[] = [];
    for (const planet of this.planets.values()) {
      meshes.push(planet.mesh);
    }
    for (const body of this.bodies) {
      meshes.push(body.mesh);
    }
    this.interactiveMeshes = meshes;
    if (!meshes.includes(this.hoveredMesh as THREE.Mesh)) {
      this.hoveredMesh = null;
      this.hideTooltip();
    }
  }

  private onPointerMove = (event: PointerEvent): void => {
    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    if (canvasRect.width === 0 || canvasRect.height === 0) return;

    this.pointer.x = ((event.clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - canvasRect.top) / canvasRect.height) * 2 + 1;

    const hostRect = this.options.host.getBoundingClientRect();
    this.pointerClient.x = event.clientX - hostRect.left;
    this.pointerClient.y = event.clientY - hostRect.top;
    this.pointerViewport = { x: event.clientX, y: event.clientY };

    this.hasPointer = true;
  };

  private onPointerLeave = (): void => {
    this.hasPointer = false;
    this.hoveredMesh = null;
    this.hideTooltip();
  };

  private updateHover(): void {
    if (!this.hasPointer || this.interactiveMeshes.length === 0) {
      this.hoveredMesh = null;
      this.hideTooltip();
      return;
    }

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.interactiveMeshes, false);
    const hit = intersections.find((entry) => entry.object.visible);
    if (!hit || !(hit.object instanceof THREE.Mesh)) {
      const hostRect = this.options.host.getBoundingClientRect();
      const width = hostRect.width;
      const height = hostRect.height;
      if (width <= 0 || height <= 0) {
        this.hoveredMesh = null;
        this.hideTooltip();
        return;
      }

      let closest: { mesh: THREE.Mesh; label: string; distance: number } | null = null;
      for (const mesh of this.interactiveMeshes) {
        if (!mesh.visible) continue;
        const label = typeof mesh.userData.hoverLabel === 'string' ? mesh.userData.hoverLabel : '';
        if (!label) continue;

        mesh.getWorldPosition(this.projected);
        this.projected.project(this.camera);
        if (this.projected.z < -1 || this.projected.z > 1) continue;

        const screenX = ((this.projected.x + 1) / 2) * width;
        const screenY = ((-this.projected.y + 1) / 2) * height;
        const dx = screenX - this.pointerClient.x;
        const dy = screenY - this.pointerClient.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 32) continue;
        if (!closest || distance < closest.distance) {
          closest = { mesh, label, distance };
        }
      }

      if (!closest) {
        this.hoveredMesh = null;
        this.hideTooltip();
        return;
      }

      this.hoveredMesh = closest.mesh;
      this.showTooltip(closest.label);
      return;
    }

    this.hoveredMesh = hit.object;
    const label = typeof hit.object.userData.hoverLabel === 'string' ? hit.object.userData.hoverLabel : '';
    if (!label) {
      this.hideTooltip();
      return;
    }

    this.showTooltip(label);
  }

  private showTooltip(label: string): void {
    if (this.tooltip.textContent !== label) {
      this.tooltip.textContent = label;
    }
    const hostRect = this.options.host.getBoundingClientRect();
    const hostWidth = hostRect.width;
    const hostHeight = hostRect.height;
    if (hostWidth <= 0 || hostHeight <= 0) {
      this.hideTooltip();
      return;
    }

    this.tooltip.style.opacity = '1';
    this.tooltip.style.visibility = 'visible';

    const offsetWidth = this.tooltip.offsetWidth;
    const offsetHeight = this.tooltip.offsetHeight;

    const padding = 8;
    let x = this.pointerViewport.x + 12;
    let y = this.pointerViewport.y + 12;
    const minX = hostRect.left + padding;
    const maxX = hostRect.right - offsetWidth - padding;
    const minY = hostRect.top + padding;
    const maxY = hostRect.bottom - offsetHeight - padding;
    x = Math.min(maxX, Math.max(minX, x));
    y = Math.min(maxY, Math.max(minY, y));

    this.tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private hideTooltip(): void {
    this.tooltip.style.opacity = '0';
    this.tooltip.style.visibility = 'hidden';
    this.tooltip.style.transform = 'translate(-9999px, -9999px)';
  }
}
