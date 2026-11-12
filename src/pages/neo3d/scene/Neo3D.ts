/** The heliocentric NEO scene: renderer, camera, simulation clock, hover tooltips. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { jdFromDate } from '../../../lib/julian';
import { propagate, prepareKeplerian, type PreparedKeplerian } from '../../../orbits/kepler';
import {
  buildCirclePolyline,
  buildOrbitPoints,
  buildSampleOrbitPoints,
  createBodyMesh,
  createGridRing,
  createPlanetMesh,
  makeOrbitLine,
} from './bodies';
import {
  SCALE,
  SIZE_MULTIPLIER,
  isFiniteVec3,
  toScene,
  type OrbitSample,
  type PlanetSampleProvider,
  type SmallBodySpec,
} from './types';

export type { OrbitSample, PlanetSampleProvider, SmallBodySpec } from './types';

const DAY_MS = 86_400_000;

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
  shape: 'comet' | 'asteroid';
  propagator?: PreparedKeplerian;
}

interface PlanetNode {
  provider: PlanetSampleProvider;
  mesh: THREE.Mesh;
  orbitLine?: THREE.Line;
  lastPos?: [number, number, number] | null;
  extras?: THREE.Object3D[];
}

export class Neo3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private readonly host: HTMLElement;
  private readonly celestialRadius = 24 * SCALE;
  private readonly defaultCameraPosition = new THREE.Vector3(6 * SCALE, 6 * SCALE, 10 * SCALE);
  private readonly defaultTarget = new THREE.Vector3(0, 0, 0);
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
  private cometVelocity = new THREE.Vector3();
  private cometTailAxis = new THREE.Vector3();
  private cometAdjust = new THREE.Quaternion();
  private cometBase = new THREE.Quaternion();
  private panOffset = new THREE.Vector3();
  private panAxisX = new THREE.Vector3();
  private panAxisY = new THREE.Vector3();
  private panDelta = new THREE.Vector3();
  private zoomOffset = new THREE.Vector3();

  constructor(private readonly options: Neo3DOptions) {
    const { host } = options;
    this.host = host;
    const width = host.clientWidth || 800;
    const height = host.clientHeight || 520;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.setClearColor(0x05060a, 1);
    host.replaceChildren(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.visibility = 'visible';

    this.camera = new THREE.PerspectiveCamera(52, width / height, 0.005, 6000 * SCALE);
    this.camera.position.copy(this.defaultCameraPosition);
    this.camera.lookAt(this.defaultTarget);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = 0.98 * (Math.PI / 2);
    this.controls.minDistance = 0;
    this.controls.maxDistance = 600 * SCALE;
    this.controls.target.copy(this.defaultTarget);
    this.controls.update();
    this.controls.saveState();

    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    const sunLight = new THREE.PointLight(0xfff5c0, 3.2, 0, 2);
    sunLight.position.set(0, 0, 0);
    
    const sunMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff1a8,
      emissive: 0xffdd66,
      emissiveIntensity: 1.4,
      roughness: 0.35,
      metalness: 0.1,
      toneMapped: false,
    });
    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.06 * SIZE_MULTIPLIER * SCALE, 48, 32), sunMaterial);
    sun.castShadow = false;
    sun.receiveShadow = false;
    
    this.scene.add(ambient, sunLight, sun, createGridRing());

    this.simMs = (options.initialDate ?? new Date()).getTime();
    this.minMs = options.minDate?.getTime() ?? Number.NEGATIVE_INFINITY;
    this.maxMs = options.maxDate?.getTime() ?? Number.POSITIVE_INFINITY;

    if (typeof window !== 'undefined') {
      const computed = window.getComputedStyle(this.host);
      if (computed.position === 'static') {
        this.host.style.position = 'relative';
      }
    }

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'neo3d-tooltip';
    Object.assign(this.tooltip.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      pointerEvents: 'none',
      background: '#f0ece2',
      color: '#0b0c10',
      padding: '5px 9px',
      borderRadius: '0',
      fontSize: '13px',
      fontWeight: '600',
      lineHeight: '16px',
      whiteSpace: 'nowrap',
      opacity: '0',
      transform: 'translate(-9999px, -9999px)',
      transition: 'opacity 0.12s ease',
      zIndex: '1000',
    });
    const tooltipParent = typeof document !== 'undefined' && document.body ? document.body : this.host;
    tooltipParent.appendChild(this.tooltip);

    this.scene.userData.celestialRadius = this.celestialRadius;

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);

    window.addEventListener('resize', () => this.onResize());
  }

  panBy(deltaX: number, deltaY: number): void {
    const element = this.renderer.domElement;
    if (element.clientHeight === 0) return;

    const offset = this.panOffset;
    offset.copy(this.camera.position).sub(this.controls.target);
    const distance = offset.length();
    if (distance <= 0 || !Number.isFinite(distance)) {
      return;
    }

    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const targetDistance = distance * Math.tan(fov / 2);
    if (!Number.isFinite(targetDistance)) {
      return;
    }

    const panX = (2 * deltaX * targetDistance) / element.clientHeight;
    const panY = (2 * deltaY * targetDistance) / element.clientHeight;
    if (!Number.isFinite(panX) || !Number.isFinite(panY)) {
      return;
    }

    this.panAxisX.setFromMatrixColumn(this.camera.matrix, 0).multiplyScalar(-panX);
    this.panAxisY.setFromMatrixColumn(this.camera.matrix, 1).multiplyScalar(panY);

    this.panDelta.copy(this.panAxisX).add(this.panAxisY);
    this.camera.position.add(this.panDelta);
    this.controls.target.add(this.panDelta);
    this.controls.update();
  }

  zoomBy(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;

    const offset = this.zoomOffset;
    offset.copy(this.camera.position).sub(this.controls.target);
    const distance = offset.length();
    if (!Number.isFinite(distance) || distance <= 0) {
      return;
    }

    const minDistance = Math.max(this.controls.minDistance, 0.0005);
    const maxDistance = this.controls.maxDistance;
    const nextDistance = THREE.MathUtils.clamp(distance * factor, minDistance, maxDistance);
    if (!Number.isFinite(nextDistance) || nextDistance === distance) {
      return;
    }

    offset.setLength(nextDistance);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  resetView(): void {
    this.camera.position.copy(this.defaultCameraPosition);
    this.controls.target.copy(this.defaultTarget);
    this.controls.update();
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  getHostElement(): HTMLElement {
    return this.host;
  }

  getCelestialRadius(): number {
    return this.celestialRadius;
  }

  addOverlay(object: THREE.Object3D): void {
    this.scene.add(object);
  }

  focusOnWorld(position: THREE.Vector3, options: { distance?: number } = {}): void {
    const target = position.clone();
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) {
      return;
    }
    const direction = position.clone();
    const length = direction.length();
    if (!Number.isFinite(length) || length <= 0) {
      return;
    }
    direction.normalize();
    const minDistance = Math.max(this.controls.minDistance, 0.001);
    const maxDistance = this.controls.maxDistance;
    const desired = options.distance && Number.isFinite(options.distance)
      ? options.distance
      : Math.max(length * 1.8, minDistance * 2);
    const distance = THREE.MathUtils.clamp(desired, minDistance, maxDistance);
    this.controls.target.copy(target);
    this.camera.position.copy(direction.multiplyScalar(distance));
    this.controls.update();
  }

  getCameraDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
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
      if (planet.extras) {
        for (const extra of planet.extras) {
          this.scene.remove(extra);
        }
      }
    }
    this.planets.clear();

    for (const provider of providers) {
      const { mesh, extras } = createPlanetMesh(provider);
      mesh.visible = false;
      mesh.userData.hoverLabel = provider.name;
      this.scene.add(mesh);

      if (extras.length > 0) {
        for (const extra of extras) {
          extra.visible = false;
          this.scene.add(extra);
        }
      }

      let orbitLine: THREE.Line | undefined;
      if (typeof provider.orbitRadius === 'number' && provider.orbitRadius > 0) {
        orbitLine = buildCirclePolyline(provider.orbitRadius, provider.color, 256);
        this.scene.add(orbitLine);
      }

      this.planets.set(provider.name, { provider, mesh, orbitLine, extras });
    }

    this.refreshInteractiveMeshes();
  }

  setSmallBodies(bodies: SmallBodySpec[]): void {
    this.clearSmallBodies();
    this.addSmallBodies(bodies);
  }

  addSmallBodies(bodies: SmallBodySpec[]): void {
    for (const spec of bodies) {
      const mesh = createBodyMesh(spec);
      mesh.visible = false;
      mesh.userData.hoverLabel = spec.label ?? spec.name;
      this.scene.add(mesh);

      const propagator = spec.els ? prepareKeplerian(spec.els) : undefined;

      let orbitLine: THREE.Line | undefined;
      if (spec.orbit) {
        const segments = Math.max(64, spec.orbit.segments ?? 512);
        let points: Float32Array | null = null;
        if (spec.els) {
          points = buildOrbitPoints(spec.els, segments, spec.orbit.spanDays, propagator);
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

      const shape = (mesh.userData.shape as 'comet' | 'asteroid') ?? 'asteroid';
      this.bodies.push({ spec, mesh, orbitLine, shape, propagator });
    }

    this.refreshInteractiveMeshes();
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
        const scenePos = toScene(position);
        node.mesh.position.copy(scenePos);
        if (node.extras) {
          for (const extra of node.extras) {
            extra.visible = true;
            extra.position.copy(scenePos);
          }
        }
        if (node.orbitLine) node.orbitLine.visible = true;
        node.lastPos = [position[0], position[1], position[2]];
      } else {
        node.mesh.visible = false;
        if (node.extras) {
          for (const extra of node.extras) {
            extra.visible = false;
          }
        }
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
      let sampleState: OrbitSample | null = null;
      if (body.propagator) {
        const propagated = body.propagator.propagate(jd);
        if (propagated && isFiniteVec3(propagated)) {
          pos = [propagated[0], propagated[1], propagated[2]];
        }
      } else if (body.spec.els) {
        const propagated = propagate(body.spec.els, jd);
        if (isFiniteVec3(propagated)) {
          pos = [propagated[0], propagated[1], propagated[2]];
        }
      }
      if (!pos && body.spec.sample) {
        sampleState = body.spec.sample(now);
        if (sampleState && isFiniteVec3(sampleState.posAU)) pos = sampleState.posAU;
      }

      if (!pos) {
        body.mesh.visible = false;
        if (body.orbitLine) body.orbitLine.visible = true;
        body.lastPos = null;
        continue;
      }

      body.mesh.visible = true;
      body.mesh.position.copy(toScene(pos));
      if (body.shape === 'comet') {
        const velocity = this.deriveCometVelocity(body, now, jd, sampleState);
        if (velocity) {
          this.orientCometTail(body.mesh, velocity);
        }
      }
      if (body.orbitLine) body.orbitLine.visible = true;
      body.lastPos = [pos[0], pos[1], pos[2]];
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateHover();

    if (this.options.onDateChange) {
      this.options.onDateChange(now);
    }
  }

  private deriveCometVelocity(
    body: RenderBody,
    now: Date,
    jd: number,
    sampleState: OrbitSample | null,
  ): [number, number, number] | null {
    const deltaDays = 1 / 2880;
    if (body.propagator) {
      const next = body.propagator.propagate(jd + deltaDays);
      const prev = body.propagator.propagate(jd - deltaDays);
      if (next && prev && isFiniteVec3(next) && isFiniteVec3(prev)) {
        const scale = 1 / (2 * deltaDays);
        return [
          (next[0] - prev[0]) * scale,
          (next[1] - prev[1]) * scale,
          (next[2] - prev[2]) * scale,
        ];
      }
      return null;
    }
    if (body.spec.els) {
      const next = propagate(body.spec.els, jd + deltaDays);
      const prev = propagate(body.spec.els, jd - deltaDays);
      if (isFiniteVec3(next) && isFiniteVec3(prev)) {
        const scale = 1 / (2 * deltaDays);
        return [
          (next[0] - prev[0]) * scale,
          (next[1] - prev[1]) * scale,
          (next[2] - prev[2]) * scale,
        ];
      }
      return null;
    }

    if (body.spec.sample) {
      if (sampleState?.velAUPerDay && isFiniteVec3(sampleState.velAUPerDay)) {
        return [
          sampleState.velAUPerDay[0],
          sampleState.velAUPerDay[1],
          sampleState.velAUPerDay[2],
        ];
      }

      const deltaMs = 30_000;
      const offset = deltaMs / 2;
      const prevState = body.spec.sample(new Date(now.getTime() - offset));
      const nextState = body.spec.sample(new Date(now.getTime() + offset));
      if (
        prevState &&
        nextState &&
        isFiniteVec3(prevState.posAU) &&
        isFiniteVec3(nextState.posAU)
      ) {
        const deltaSampleDays = (offset * 2) / DAY_MS;
        const scale = 1 / (2 * deltaSampleDays);
        return [
          (nextState.posAU[0] - prevState.posAU[0]) * scale,
          (nextState.posAU[1] - prevState.posAU[1]) * scale,
          (nextState.posAU[2] - prevState.posAU[2]) * scale,
        ];
      }
    }

    return null;
  }

  private orientCometTail(mesh: THREE.Mesh, velocity: readonly number[]): void {
    if (!Number.isFinite(velocity[0]) || !Number.isFinite(velocity[1]) || !Number.isFinite(velocity[2])) {
      return;
    }

    const baseQuaternion = mesh.userData.baseQuaternion as THREE.Quaternion | undefined;
    const tailAxis = mesh.userData.tailAxis as THREE.Vector3 | undefined;
    if (!baseQuaternion || !tailAxis) {
      return;
    }

    this.cometVelocity.set(velocity[0], velocity[2], velocity[1]);
    if (this.cometVelocity.lengthSq() < 1e-12) {
      return;
    }
    this.cometVelocity.normalize().negate();

    this.cometTailAxis.copy(tailAxis).applyQuaternion(baseQuaternion);
    this.cometAdjust.setFromUnitVectors(this.cometTailAxis, this.cometVelocity);
    this.cometBase.copy(baseQuaternion);
    mesh.quaternion.copy(this.cometAdjust.multiply(this.cometBase));
  }

  private onResize(): void {
    const width = this.host.clientWidth || 800;
    const height = this.host.clientHeight || 520;
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

    const hostRect = this.host.getBoundingClientRect();
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
      const hostRect = this.host.getBoundingClientRect();
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
    const hostRect = this.host.getBoundingClientRect();
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
