import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { jdFromDate, propagate, type Keplerian } from '../utils/orbit';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

declare global {
  interface Window {
    NEO_GLYPHS?: boolean;
  }
}

const SCALE = 120;
const SIZE_MULTIPLIER = 2;
const DAY_MS = 86_400_000;
const TWO_PI = Math.PI * 2;

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
  lastPos?: [number, number, number] | null;
}

interface PlanetNode {
  provider: PlanetSampleProvider;
  mesh: THREE.Mesh;
  orbitLine?: THREE.Line;
  lastPos?: [number, number, number] | null;
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

function buildOrbitPoints(els: Keplerian, segments: number, spanDays?: number): Float32Array {
  const key = orbitKey(els, segments, spanDays);
  const cached = orbitCache.get(key);
  if (cached) return cached;

  const points: number[] = [];
  if (els.e < 1) {
    for (let i = 0; i <= segments; i += 1) {
      const nu = (i / segments) * TWO_PI;
      const pos = ellipsePoint(els, nu);
      if (!pos || !isFiniteVec3(pos)) continue;
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
  const geometry = new THREE.SphereGeometry(radius * SIZE_MULTIPLIER * SCALE, 24, 16);
  const material = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.6 });
  return new THREE.Mesh(geometry, material);
}

function createBodyMesh(color: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(0.008 * SIZE_MULTIPLIER * SCALE, 16, 12);
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
  private glyphSvg: SVGSVGElement | null = null;
  private glyphLayer: SVGGElement | null = null;
  private glyphsEnabled = true;
  private glyphInstances = new Map<string, GlyphInstance>();

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
    this.controls.zoomToCursor = true;
    this.controls.maxPolarAngle = 0.98 * (Math.PI / 2);
    this.controls.minDistance = 0.05 * SCALE;
    this.controls.maxDistance = 40 * SCALE;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const sunLight = new THREE.PointLight(0xfff5c0, 2.4, 0, 2);
    sunLight.position.set(0, 0, 0);
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(0.06 * SIZE_MULTIPLIER * SCALE, 32, 24),
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

    this.ensureGlyphOverlay();
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
    if (this.glyphsEnabled) {
      this.refreshGlyphEntries();
    }
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
    if (this.glyphsEnabled) {
      this.refreshGlyphEntries();
    }
  }

  removeSmallBody(name: string): void {
    const keep: typeof this.bodies = [];
    let removed = false;
    for (const body of this.bodies) {
      if (body.spec.name === name) {
        this.scene.remove(body.mesh);
        if (body.orbitLine) this.scene.remove(body.orbitLine);
        removed = true;
      } else {
        keep.push(body);
      }
    }
    if (removed) {
      this.bodies = keep;
      this.refreshInteractiveMeshes();
      if (this.glyphsEnabled) {
        this.refreshGlyphEntries();
      }
    }
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
    if (this.glyphsEnabled) {
      this.refreshGlyphEntries();
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
        node.lastPos = [position[0], position[1], position[2]];
      } else {
        node.mesh.visible = false;
        if (node.orbitLine) node.orbitLine.visible = false;
        node.lastPos = null;
      }
    }

    for (const body of this.bodies) {
      if (!this.smallBodiesVisible) {
        body.mesh.visible = false;
        if (body.orbitLine) body.orbitLine.visible = false;
        body.lastPos = null;
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
        body.lastPos = null;
        continue;
      }

      body.mesh.visible = true;
      body.mesh.position.copy(toScene(pos));
      if (body.orbitLine) body.orbitLine.visible = true;
      body.lastPos = [pos[0], pos[1], pos[2]];
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.renderGlyphLayer();
    this.updateHover();

    if (this.options.onDateChange) {
      this.options.onDateChange(now);
    }
  }

  private renderGlyphLayer(): void {
    if (!this.glyphsEnabled) return;
    if (!this.isGlyphFeatureActive()) {
      if (this.glyphSvg) {
        this.glyphSvg.style.display = 'none';
        this.glyphSvg.setAttribute('aria-hidden', 'true');
      }
      return;
    }
    if (!this.glyphSvg || !this.glyphLayer) {
      this.ensureGlyphOverlay();
    }
    if (!this.glyphSvg || !this.glyphLayer) return;

    const canvasRect = this.renderer.domElement.getBoundingClientRect();
    const hostRect = this.options.host.getBoundingClientRect();
    const width = canvasRect.width || this.options.host.clientWidth || 0;
    const height = canvasRect.height || this.options.host.clientHeight || 0;
    if (width <= 0 || height <= 0) return;

    this.glyphSvg.style.display = 'block';
    this.glyphSvg.setAttribute('aria-hidden', 'false');
    this.glyphSvg.setAttribute('width', `${width}`);
    this.glyphSvg.setAttribute('height', `${height}`);
    this.glyphSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const offsetX = canvasRect.left - hostRect.left;
    const offsetY = canvasRect.top - hostRect.top;
    this.glyphSvg.style.left = `${offsetX}px`;
    this.glyphSvg.style.top = `${offsetY}px`;
    this.glyphSvg.style.width = `${width}px`;
    this.glyphSvg.style.height = `${height}px`;
    this.glyphSvg.style.right = 'auto';
    this.glyphSvg.style.bottom = 'auto';
    this.glyphLayer.removeAttribute('transform');

    const cameraDistance = this.camera.position.distanceTo(this.controls.target);
    const zoom = THREE.MathUtils.clamp((SCALE * 0.35) / Math.max(cameraDistance, 0.001), 0.35, 4);
    const sunScreen = projectWorldToScreen(ORIGIN_VECTOR, this.camera, width, height);

    renderGlyphsTick({
      entries: this.glyphInstances,
      camera: this.camera,
      width,
      height,
      zoom,
      sunScreen,
      hovered: this.hoveredMesh,
    });
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

  private refreshGlyphEntries(): void {
    if (!this.isGlyphFeatureActive()) return;
    if (!this.glyphLayer) {
      this.ensureGlyphOverlay();
    }
    if (!this.glyphLayer) return;

    const entries: GlyphDatum[] = [];

    for (const [name, planet] of this.planets) {
      const label = planet.provider.name;
      entries.push({
        id: `planet-${name}`,
        name: label,
        label,
        color: planet.provider.color,
        mesh: planet.mesh,
        isPlanet: true,
        kindHint: planet.provider.kindHint,
        absMag: planet.provider.absMag,
        diameterKm: planet.provider.diameterKm,
        getLastPos: () => planet.lastPos ?? null,
      });
    }

    for (const body of this.bodies) {
      const id = body.spec.id ?? body.spec.name;
      const label = body.spec.label ?? body.spec.name;
      entries.push({
        id,
        name: body.spec.name,
        label,
        color: body.spec.color,
        mesh: body.mesh,
        isPlanet: body.spec.isPlanet,
        kindHint: body.spec.kindHint,
        absMag: body.spec.absMag,
        diameterKm: body.spec.diameterKm,
        bodyType: body.spec.bodyType,
        orbitClass: body.spec.orbitClass,
        getLastPos: () => body.lastPos ?? null,
      });
    }

    this.glyphInstances = upsertGlyphs(this.glyphLayer, entries, this.glyphInstances);
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

  private ensureGlyphOverlay(): void {
    if (!this.isGlyphFeatureActive()) return;
    if (typeof document === 'undefined') return;

    const svg = ensureGlyphSvg(this.options.host);
    const layer = ensureGlyphLayer(svg);

    this.glyphSvg = svg;
    this.glyphLayer = layer;
  }

  private isGlyphFeatureActive(): boolean {
    if (!this.glyphsEnabled) return false;
    if (typeof window !== 'undefined' && window.NEO_GLYPHS === false) {
      return false;
    }
    return true;
  }
}

// === BEGIN GLYPHS: JS ===
const ORIGIN_VECTOR = new THREE.Vector3(0, 0, 0);
const TEMP_WORLD = new THREE.Vector3();
const TEMP_PROJECTED = new THREE.Vector3();
const AU_IN_PIXELS = 36;
const LABEL_H_THRESHOLD = 18;

type GlyphKind = 'planet' | 'asteroid' | 'comet';

interface GlyphDatum {
  id: string;
  name: string;
  label: string;
  color: number;
  mesh: THREE.Mesh;
  isPlanet?: boolean;
  kindHint?: string;
  absMag?: number;
  diameterKm?: number;
  bodyType?: string;
  orbitClass?: string;
  getLastPos?: () => [number, number, number] | null;
}

interface GlyphInstance {
  datum: GlyphDatum;
  group: SVGGElement;
  nucleus: SVGUseElement;
  label: SVGTextElement;
  tail?: SVGPathElement;
  ring?: SVGUseElement;
  kind: GlyphKind;
}

interface RenderGlyphContext {
  entries: Map<string, GlyphInstance>;
  camera: THREE.PerspectiveCamera;
  width: number;
  height: number;
  zoom: number;
  sunScreen: { x: number; y: number; visible: boolean };
  hovered: THREE.Mesh | null;
}

function ensureGlyphSvg(host: HTMLElement): SVGSVGElement {
  const existing = host.querySelector('svg[data-role="neo-glyph-overlay"]');
  if (existing instanceof SVGSVGElement) {
    return existing;
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('data-role', 'neo-glyph-overlay');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('preserveAspectRatio', 'none');
  const width = host.clientWidth || 1;
  const height = host.clientHeight || 1;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  Object.assign(svg.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '0',
    height: '0',
    right: 'auto',
    bottom: 'auto',
    pointerEvents: 'none',
    zIndex: '2',
  });
  host.appendChild(svg);
  return svg;
}

function ensureGlyphDefs(rootSvg: SVGSVGElement): void {
  if (rootSvg.querySelector('#neo-sym-asteroid')) return;

  const startComment = document.createComment(' === BEGIN GLYPHS: DEFS === ');
  const endComment = document.createComment(' === END GLYPHS: DEFS === ');
  const defs = document.createElementNS(SVG_NS, 'defs');

  const gradient = document.createElementNS(SVG_NS, 'linearGradient');
  gradient.setAttribute('id', 'neo-tailGrad');
  gradient.setAttribute('x1', '0');
  gradient.setAttribute('y1', '0');
  gradient.setAttribute('x2', '1');
  gradient.setAttribute('y2', '0');

  const stops: Array<{ offset: string; color: string; opacity: string }> = [
    { offset: '0', color: 'hsl(185 80% 60%)', opacity: '0.75' },
    { offset: '0.25', color: 'hsl(185 80% 60%)', opacity: '0.45' },
    { offset: '1', color: 'hsl(185 80% 60%)', opacity: '0' },
  ];
  for (const stopConfig of stops) {
    const stop = document.createElementNS(SVG_NS, 'stop');
    stop.setAttribute('offset', stopConfig.offset);
    stop.setAttribute('stop-color', stopConfig.color);
    stop.setAttribute('stop-opacity', stopConfig.opacity);
    gradient.appendChild(stop);
  }
  defs.appendChild(gradient);

  const asteroid = document.createElementNS(SVG_NS, 'symbol');
  asteroid.setAttribute('id', 'neo-sym-asteroid');
  asteroid.setAttribute('viewBox', '-10 -10 20 20');
  const asteroidPath = document.createElementNS(SVG_NS, 'path');
  asteroidPath.setAttribute('d', 'M-6-4 L-2-8 L4-6 L8-1 L6 4 L0 8 L-6 6 L-8 0 Z');
  asteroidPath.setAttribute('fill', 'currentColor');
  asteroid.appendChild(asteroidPath);
  const asteroidHighlight = document.createElementNS(SVG_NS, 'circle');
  asteroidHighlight.setAttribute('r', '1.5');
  asteroidHighlight.setAttribute('cx', '-2');
  asteroidHighlight.setAttribute('cy', '-2');
  asteroidHighlight.setAttribute('fill', 'hsl(0 0% 100% / .25)');
  asteroid.appendChild(asteroidHighlight);
  const asteroidShadow = document.createElementNS(SVG_NS, 'circle');
  asteroidShadow.setAttribute('r', '1');
  asteroidShadow.setAttribute('cx', '3');
  asteroidShadow.setAttribute('cy', '2');
  asteroidShadow.setAttribute('fill', 'hsl(0 0% 0% / .25)');
  asteroid.appendChild(asteroidShadow);
  defs.appendChild(asteroid);

  const nucleus = document.createElementNS(SVG_NS, 'symbol');
  nucleus.setAttribute('id', 'neo-sym-nucleus');
  nucleus.setAttribute('viewBox', '-6 -6 12 12');
  const nucleusCircle = document.createElementNS(SVG_NS, 'circle');
  nucleusCircle.setAttribute('r', '5');
  nucleusCircle.setAttribute('fill', 'currentColor');
  nucleus.appendChild(nucleusCircle);
  defs.appendChild(nucleus);

  const planet = document.createElementNS(SVG_NS, 'symbol');
  planet.setAttribute('id', 'neo-sym-planet');
  planet.setAttribute('viewBox', '-10 -10 20 20');
  const planetCircle = document.createElementNS(SVG_NS, 'circle');
  planetCircle.setAttribute('r', '9');
  planetCircle.setAttribute('fill', 'currentColor');
  planet.appendChild(planetCircle);
  defs.appendChild(planet);

  const ring = document.createElementNS(SVG_NS, 'symbol');
  ring.setAttribute('id', 'neo-sym-ring');
  ring.setAttribute('viewBox', '-16 -8 32 16');
  const ringEllipse = document.createElementNS(SVG_NS, 'ellipse');
  ringEllipse.setAttribute('rx', '14');
  ringEllipse.setAttribute('ry', '6');
  ringEllipse.setAttribute('fill', 'none');
  ringEllipse.setAttribute('stroke', 'currentColor');
  ringEllipse.setAttribute('stroke-width', '1.5');
  ringEllipse.setAttribute('opacity', '.7');
  ring.appendChild(ringEllipse);
  defs.appendChild(ring);

  const fragment = document.createDocumentFragment();
  fragment.append(startComment, defs, endComment);
  const firstChild = rootSvg.firstChild;
  if (firstChild) {
    rootSvg.insertBefore(fragment, firstChild);
  } else {
    rootSvg.appendChild(fragment);
  }
}

function ensureGlyphLayer(rootSvg: SVGSVGElement): SVGGElement {
  ensureGlyphDefs(rootSvg);

  let orbitLayer = rootSvg.querySelector('#orbit-layer');
  if (!(orbitLayer instanceof SVGGElement)) {
    orbitLayer = document.createElementNS(SVG_NS, 'g');
    orbitLayer.setAttribute('id', 'orbit-layer');
    orbitLayer.dataset.role = 'orbits';
    rootSvg.appendChild(orbitLayer);
  }

  let glyphLayer = rootSvg.querySelector('#glyph-layer');
  if (!(glyphLayer instanceof SVGGElement)) {
    glyphLayer = document.createElementNS(SVG_NS, 'g');
    glyphLayer.setAttribute('id', 'glyph-layer');
    glyphLayer.dataset.role = 'glyphs';
    if (orbitLayer.nextSibling) {
      rootSvg.insertBefore(glyphLayer, orbitLayer.nextSibling);
    } else {
      rootSvg.appendChild(glyphLayer);
    }
  }

  return glyphLayer;
}

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function setUseHref(target: SVGUseElement, value: string): void {
  target.setAttribute('href', value);
  target.setAttributeNS(XLINK_NS, 'href', value);
}

function isPlanetName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    lower === 'mercury' ||
    lower === 'venus' ||
    lower === 'earth' ||
    lower === 'mars' ||
    lower === 'jupiter' ||
    lower === 'saturn' ||
    lower === 'uranus' ||
    lower === 'neptune' ||
    lower === 'pluto'
  );
}

function classifyBody(body: GlyphDatum): GlyphKind {
  const hint = (body.kindHint ?? '').toLowerCase();
  if (body.isPlanet || hint.includes('planet') || isPlanetName(body.name)) {
    return 'planet';
  }

  const name = body.name ?? '';
  if (/^(c|p)\//i.test(name)) {
    return 'comet';
  }

  const descriptors = `${hint} ${body.bodyType ?? ''} ${body.orbitClass ?? ''}`.toLowerCase();
  if (/comet|interstellar|centaur|damocloid|jfc|ptc/.test(descriptors)) {
    return 'comet';
  }

  return 'asteroid';
}

function glyphAriaLabel(datum: GlyphDatum, kind: GlyphKind): string {
  const name = (datum.label || datum.name || datum.id).trim();
  switch (kind) {
    case 'planet':
      return name ? `Planet ${name}` : 'Planet';
    case 'comet':
      return name ? `Comet ${name}` : 'Comet';
    default:
      return name ? `Asteroid ${name}` : 'Asteroid';
  }
}

function planetColor(name: string): string {
  switch (name.trim().toLowerCase()) {
    case 'mercury':
      return 'hsl(210 10% 65%)';
    case 'venus':
      return 'hsl(38 80% 60%)';
    case 'earth':
      return 'hsl(205 75% 55%)';
    case 'mars':
      return 'hsl(12 70% 55%)';
    case 'jupiter':
      return 'hsl(35 70% 60%)';
    case 'saturn':
      return 'hsl(48 75% 70%)';
    case 'uranus':
      return 'hsl(195 70% 65%)';
    case 'neptune':
      return 'hsl(220 70% 60%)';
    case 'pluto':
      return 'hsl(30 25% 70%)';
    default:
      return 'hsl(200 40% 55%)';
  }
}

function pxFromH(H: number | undefined, zoom: number, diameterKm?: number): number {
  const zoomScale = THREE.MathUtils.clamp(Math.pow(Math.max(zoom, 0.0001), 0.4), 0.55, 2.4);
  if (typeof H === 'number' && Number.isFinite(H)) {
    const base = 16 - (H - 10) * 0.9;
    const size = THREE.MathUtils.clamp(base, 4, 22);
    return size * zoomScale;
  }
  if (typeof diameterKm === 'number' && Number.isFinite(diameterKm) && diameterKm > 0) {
    const scale = Math.sqrt(diameterKm);
    const size = THREE.MathUtils.clamp(scale * 0.35, 3, 24);
    return size * zoomScale;
  }
  return THREE.MathUtils.clamp(3 * zoomScale, 2, 12);
}

function tailLenAU(rAU?: number): number {
  const distance = typeof rAU === 'number' && Number.isFinite(rAU) ? Math.max(rAU, 0.1) : 1;
  const len = 0.9 / distance;
  return THREE.MathUtils.clamp(len, 0.2, 3.2);
}

function symbolForKind(kind: GlyphKind): string {
  switch (kind) {
    case 'planet':
      return '#neo-sym-planet';
    case 'comet':
      return '#neo-sym-nucleus';
    case 'asteroid':
    default:
      return '#neo-sym-asteroid';
  }
}

function shouldShowRing(name: string): boolean {
  return /saturn/i.test(name);
}

function upsertGlyphs(
  glyphLayer: SVGGElement,
  bodies: GlyphDatum[],
  existing: Map<string, GlyphInstance>,
): Map<string, GlyphInstance> {
  const next = new Map<string, GlyphInstance>();
  const seen = new Set<string>();

  for (const datum of bodies) {
    if (!datum.id) continue;
    const kind = classifyBody(datum);
    const aria = glyphAriaLabel(datum, kind);
    let instance = existing.get(datum.id);
    if (!instance) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.classList.add('glyph', kind);
      group.dataset.kind = kind;
      group.style.display = 'none';
      group.setAttribute('role', 'img');
      group.setAttribute('tabindex', '0');
      group.setAttribute('focusable', 'true');
      group.setAttribute('aria-hidden', 'true');
      group.setAttribute('aria-label', aria);

      let tail: SVGPathElement | undefined;
      if (kind === 'comet') {
        tail = document.createElementNS(SVG_NS, 'path');
        tail.setAttribute('class', 'tail');
        group.appendChild(tail);
      }

      const nucleus = document.createElementNS(SVG_NS, 'use');
      nucleus.setAttribute('class', 'nucleus');
      setUseHref(nucleus, symbolForKind(kind));
      group.appendChild(nucleus);

      let ring: SVGUseElement | undefined;
      if (kind === 'planet' && shouldShowRing(datum.name)) {
        ring = document.createElementNS(SVG_NS, 'use');
        ring.setAttribute('class', 'ring');
        setUseHref(ring, '#neo-sym-ring');
        group.insertBefore(ring, nucleus);
      }

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('class', 'label');
      label.setAttribute('dominant-baseline', 'middle');
      label.setAttribute('text-anchor', 'start');
      label.setAttribute('x', '0');
      label.setAttribute('y', '0');
      group.appendChild(label);

      glyphLayer.appendChild(group);
      instance = { datum, group, nucleus, label, tail, ring, kind };
    } else {
      instance.group.classList.add('glyph');
      instance.group.classList.remove('planet', 'asteroid', 'comet');
      instance.group.classList.add(kind);
      instance.group.dataset.kind = kind;
      instance.kind = kind;
      instance.group.setAttribute('role', 'img');
      instance.group.setAttribute('focusable', 'true');
      instance.group.setAttribute('aria-label', aria);
      if (instance.tail && kind !== 'comet') {
        instance.tail.remove();
        instance.tail = undefined;
      } else if (!instance.tail && kind === 'comet') {
        const tail = document.createElementNS(SVG_NS, 'path');
        tail.setAttribute('class', 'tail');
        instance.group.insertBefore(tail, instance.nucleus);
        instance.tail = tail;
      }
      if (kind === 'planet' && shouldShowRing(datum.name)) {
        if (!instance.ring) {
          const ring = document.createElementNS(SVG_NS, 'use');
          ring.setAttribute('class', 'ring');
          setUseHref(ring, '#neo-sym-ring');
          instance.group.insertBefore(ring, instance.nucleus);
          instance.ring = ring;
        }
      } else if (instance.ring) {
        instance.ring.remove();
        instance.ring = undefined;
      }
      setUseHref(instance.nucleus, symbolForKind(kind));
      glyphLayer.appendChild(instance.group);
    }

    instance.datum = datum;
    instance.label.textContent = datum.label;
    instance.group.style.color = colorToCss(datum.color);
    instance.group.setAttribute('aria-label', aria);
    next.set(datum.id, instance);
    seen.add(datum.id);
  }

  for (const [id, inst] of existing.entries()) {
    if (!seen.has(id)) {
      inst.group.remove();
    }
  }

  return next;
}

function renderGlyphsTick({
  entries,
  camera,
  width,
  height,
  zoom,
  sunScreen,
  hovered,
}: RenderGlyphContext): void {
  const total = entries.size;
  const hasDensityLimit = total > 1500;
  const activeElement = typeof document !== 'undefined' ? document.activeElement : null;

  for (const instance of entries.values()) {
    const { datum, group, nucleus, tail, ring, kind } = instance;
    const mesh = datum.mesh;
    if (!mesh.visible) {
      group.style.display = 'none';
      group.setAttribute('tabindex', '-1');
      group.setAttribute('aria-hidden', 'true');
      if (activeElement === group) {
        const maybeBlur = group as unknown as { blur?: () => void };
        maybeBlur.blur?.();
      }
      continue;
    }

    mesh.getWorldPosition(TEMP_WORLD);
    TEMP_PROJECTED.copy(TEMP_WORLD).project(camera);
    if (TEMP_PROJECTED.z < -1 || TEMP_PROJECTED.z > 1) {
      group.style.display = 'none';
      group.setAttribute('tabindex', '-1');
      group.setAttribute('aria-hidden', 'true');
      if (activeElement === group) {
        const maybeBlur = group as unknown as { blur?: () => void };
        maybeBlur.blur?.();
      }
      continue;
    }

    const screenX = ((TEMP_PROJECTED.x + 1) / 2) * width;
    const screenY = ((-TEMP_PROJECTED.y + 1) / 2) * height;

    group.style.display = 'inline';
    group.setAttribute('tabindex', '0');
    group.setAttribute('aria-hidden', 'false');
    group.setAttribute('transform', `translate(${screenX.toFixed(1)},${screenY.toFixed(1)})`);

    const size = pxFromH(datum.absMag, zoom, datum.diameterKm);
    const scale = size / 10;
    nucleus.setAttribute('transform', `scale(${scale.toFixed(3)})`);

    if (ring) {
      ring.setAttribute('transform', `scale(${(scale * 1.45).toFixed(3)})`);
    }

    if (kind === 'planet') {
      group.style.setProperty('--planet-fill', planetColor(datum.name));
    } else {
      group.style.removeProperty('--planet-fill');
    }

    const pos = datum.getLastPos ? datum.getLastPos() : null;
    const distanceAu = pos ? Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]) : undefined;

    if (kind === 'comet' && tail) {
      const tailLength = tailLenAU(distanceAu) * AU_IN_PIXELS * zoom;
      if (tailLength > 1) {
        const tailWidth = Math.max(2, size * 0.6);
        const angle = Math.atan2(screenY - sunScreen.y, screenX - sunScreen.x) * (180 / Math.PI);
        const path = `M0 0 L ${tailLength.toFixed(1)} ${(-tailWidth).toFixed(1)} L ${tailLength.toFixed(1)} ${tailWidth.toFixed(1)} Z`;
        tail.setAttribute('d', path);
        tail.setAttribute('transform', `rotate(${angle.toFixed(2)})`);
        tail.style.display = 'block';
      } else {
        tail.style.display = 'none';
      }
    } else if (tail) {
      tail.style.display = 'none';
    }

    const isFocused = activeElement === group;
    const highlight = hovered === mesh || isFocused;
    group.classList.toggle('highlight', highlight);

    const showLabel =
      kind === 'planet' ||
      highlight ||
      isFocused ||
      !hasDensityLimit ||
      (typeof datum.absMag === 'number' && datum.absMag <= LABEL_H_THRESHOLD);

    instance.label.style.display = showLabel ? 'block' : 'none';
    instance.label.setAttribute('x', (size + 6).toFixed(1));
    instance.label.setAttribute('y', '0');
  }
}

function projectWorldToScreen(
  point: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  TEMP_WORLD.copy(point);
  TEMP_PROJECTED.copy(TEMP_WORLD).project(camera);
  return {
    x: ((TEMP_PROJECTED.x + 1) / 2) * width,
    y: ((-TEMP_PROJECTED.y + 1) / 2) * height,
    visible: TEMP_PROJECTED.z >= -1 && TEMP_PROJECTED.z <= 1,
  };
}
// === END GLYPHS: JS ===
