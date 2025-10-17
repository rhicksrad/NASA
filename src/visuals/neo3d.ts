import * as THREE from 'three';
import {
  earthElementsApprox,
  jdFromDate,
  propagate,
  type Keplerian,
} from '../utils/orbit';

const SCALE = 50;

export interface Body {
  name: string;
  els: Keplerian;
  color: number;
  mesh?: THREE.Object3D;
  trail?: THREE.Line;
}

export interface Neo3DOptions {
  host: HTMLElement;
}

export class Neo3D {
  private readonly host: HTMLElement;

  private readonly renderer: THREE.WebGLRenderer;

  private readonly scene = new THREE.Scene();

  private readonly camera: THREE.PerspectiveCamera;

  private readonly earth: Body;

  private readonly earthMesh: THREE.Mesh;

  private bodies: Body[] = [];

  private lastFrame = 0;

  private simOffsetMs = 0;

  private readonly epochMs = Date.now();

  private timeScale = 1;

  private paused = false;


  constructor({ host }: Neo3DOptions) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10_000);
    this.camera.position.set(0, 2 * SCALE, 3 * SCALE);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(2 * SCALE, 3 * SCALE, 1 * SCALE);
    this.scene.add(directional);

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(0.07 * SCALE, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
    );
    this.scene.add(sun);

    this.earth = { name: 'Earth', els: earthElementsApprox(), color: 0x3b82f6 };
    this.earthMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.02 * SCALE, 24, 16),
      new THREE.MeshPhongMaterial({ color: this.earth.color }),
    );
    this.earth.mesh = this.earthMesh;
    this.scene.add(this.earthMesh);

    const ellipse = new THREE.EllipseCurve(0, 0, SCALE, SCALE, 0, Math.PI * 2, false, 0);
    const orbitPoints = ellipse.getPoints(256).map((p) => new THREE.Vector3(p.x, 0, p.y));
    const earthOrbit = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(orbitPoints),
      new THREE.LineBasicMaterial({ color: 0x9ca3af }),
    );
    this.scene.add(earthOrbit);

    this.host.replaceChildren(this.renderer.domElement);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  addBodies(bodies: Body[]): void {
    for (const body of bodies) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.012 * SCALE, 16, 12),
        new THREE.MeshPhongMaterial({ color: body.color }),
      );
      const trailGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(),
      ]);
      const trail = new THREE.Line(
        trailGeometry,
        new THREE.LineBasicMaterial({ color: body.color, transparent: true, opacity: 0.6 }),
      );
      body.mesh = mesh;
      body.trail = trail;
      this.scene.add(mesh);
      this.scene.add(trail);
      this.bodies.push(body);
    }
  }

  setBodies(bodies: Body[]): void {
    this.clearBodies();
    this.addBodies(bodies);
  }

  setTimeScale(multiplier: number): void {
    this.timeScale = multiplier;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  start(): void {
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop(this.renderFrame);
  }

  private readonly renderFrame = (timestamp: number) => {
    const delta = timestamp - this.lastFrame;
    this.lastFrame = timestamp;
    if (!this.paused) {
      this.simOffsetMs += delta * this.timeScale;
    }
    const now = new Date(this.epochMs + this.simOffsetMs);
    this.update(now);
    this.renderer.render(this.scene, this.camera);
  };

  private update(date: Date): void {
    const jd = jdFromDate(date);
    const earthPosition = propagate(this.earth.els, jd);
    const earthX = earthPosition[0] * SCALE;
    const earthY = earthPosition[2] * SCALE;
    const earthZ = earthPosition[1] * SCALE;
    this.earthMesh.position.set(earthX, earthY, earthZ);

    for (const body of this.bodies) {
      const [x, y, z] = propagate(body.els, jd);
      const bodyX = x * SCALE;
      const bodyY = z * SCALE;
      const bodyZ = y * SCALE;
      body.mesh?.position.set(bodyX, bodyY, bodyZ);
      if (body.trail) {
        const geometry = body.trail.geometry as THREE.BufferGeometry;
        const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
        const prevX = attribute.getX(1);
        const prevY = attribute.getY(1);
        const prevZ = attribute.getZ(1);
        attribute.setXYZ(0, prevX, prevY, prevZ);
        attribute.setXYZ(1, bodyX, bodyY, bodyZ);
        attribute.needsUpdate = true;
      }
    }
  }

  private clearBodies(): void {
    for (const body of this.bodies) {
      if (body.mesh) {
        this.scene.remove(body.mesh);
      }
      if (body.trail) {
        this.scene.remove(body.trail);
      }
    }
    this.bodies = [];
  }

  private readonly handleResize = () => {
    const width = this.host.clientWidth || 800;
    const height = this.host.clientHeight || 500;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };
}
