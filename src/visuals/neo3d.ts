import * as THREE from 'three';
import { earthElementsApprox, jdFromDate, propagate, type Keplerian } from '../utils/orbit';

const SCALE = 50; // scene units per AU

export interface Body {
  id: string;
  name: string;
  els: Keplerian;
  color: number;
  mesh?: THREE.Object3D;
  trail?: THREE.Line;
}

export interface Neo3DOptions {
  host: HTMLElement;
  getSelected: () => Body[]; // supply selected NEOs with elements
}

export class Neo3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.Mesh;
  private earth: Body;
  private orbitRing: THREE.Line;
  private bodyMap = new Map<string, Body>();
  private bodies: Body[] = [];
  private simTimeMs = Date.now();
  private lastTick = performance.now();
  private timeScale = 1; // 1x realtime by default
  private paused = false;
  private timeListeners = new Set<(date: Date) => void>();

  constructor(private opts: Neo3DOptions) {
    const { host } = opts;
    const w = host.clientWidth || 800;
    const h = host.clientHeight || 500;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    host.replaceChildren(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 10000);
    this.camera.position.set(0, 2 * SCALE, 3 * SCALE);
    this.camera.lookAt(0, 0, 0);

    // Lights
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(2 * SCALE, 3 * SCALE, 1 * SCALE);
    this.scene.add(dir);

    // Sun
    const sunGeo = new THREE.SphereGeometry(0.07 * SCALE, 32, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    this.sun = new THREE.Mesh(sunGeo, sunMat);
    this.scene.add(this.sun);

    // Earth
    this.earth = {
      id: 'earth',
      name: 'Earth',
      els: earthElementsApprox(),
      color: 0x3b82f6,
    };
    const earthGeo = new THREE.SphereGeometry(0.02 * SCALE, 24, 16);
    const earthMat = new THREE.MeshPhongMaterial({ color: this.earth.color });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    this.earth.mesh = earthMesh;
    this.scene.add(earthMesh);

    // Earth orbit ring (unit circle approx)
    const ring = new THREE.EllipseCurve(0, 0, SCALE, SCALE, 0, Math.PI * 2, false, 0);
    const pts = ring.getPoints(256).map(p => new THREE.Vector3(p.x, 0, p.y));
    const ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
    this.orbitRing = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0x9ca3af }));
    this.scene.add(this.orbitRing);

    window.addEventListener('resize', () => this.onResize());
  }

  addBodies(list: Body[]) {
    this.setBodies(list);
  }

  setBodies(list?: Body[]) {
    const incoming = list ?? this.opts.getSelected();
    const prevMap = this.bodyMap;
    const nextMap = new Map<string, Body>();

    for (const info of incoming) {
      const key = info.id;
      if (!key) continue;
      const existing = prevMap.get(key);
      if (existing) {
        prevMap.delete(key);
        existing.els = info.els;
        existing.name = info.name;
        if (existing.color !== info.color) {
          existing.color = info.color;
          this.refreshBodyMaterial(existing);
        }
        nextMap.set(key, existing);
        continue;
      }
      const created: Body = { ...info };
      this.attachBody(created);
      nextMap.set(key, created);
    }

    for (const [, body] of prevMap) {
      this.detachBody(body);
    }

    this.bodyMap = nextMap;
    this.bodies = Array.from(nextMap.values());
  }

  private attachBody(body: Body) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.012 * SCALE, 16, 12),
      new THREE.MeshPhongMaterial({ color: body.color })
    );
    body.mesh = mesh;
    const trailGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({ color: body.color, transparent: true, opacity: 0.6 })
    );
    body.trail = trail;
    this.scene.add(mesh);
    this.scene.add(trail);
  }

  private refreshBodyMaterial(body: Body) {
    if (body.mesh instanceof THREE.Mesh) {
      const mat = body.mesh.material;
      if (Array.isArray(mat)) {
        for (const m of mat) {
          if ('color' in m) {
            (m as THREE.Material & { color: THREE.Color }).color.set(body.color);
          }
        }
      } else if (mat && 'color' in mat) {
        (mat as THREE.Material & { color: THREE.Color }).color.set(body.color);
      }
    }
    if (body.trail) {
      const mat = body.trail.material;
      if (Array.isArray(mat)) {
        for (const m of mat) {
          if ('color' in m) {
            (m as THREE.Material & { color: THREE.Color }).color.set(body.color);
          }
        }
      } else if (mat && 'color' in mat) {
        (mat as THREE.Material & { color: THREE.Color }).color.set(body.color);
      }
    }
  }

  private detachBody(body: Body) {
    if (body.mesh) {
      this.scene.remove(body.mesh);
      if (body.mesh instanceof THREE.Mesh) {
        body.mesh.geometry.dispose();
        const mat = body.mesh.material;
        if (Array.isArray(mat)) {
          for (const m of mat) m.dispose();
        } else {
          mat.dispose();
        }
      }
      body.mesh = undefined;
    }
    if (body.trail) {
      this.scene.remove(body.trail);
      body.trail.geometry.dispose();
      const mat = body.trail.material;
      if (Array.isArray(mat)) {
        for (const m of mat) m.dispose();
      } else {
        mat.dispose();
      }
      body.trail = undefined;
    }
  }

  setTimeScale(mult: number) {
    this.timeScale = mult;
  }

  setPaused(p: boolean) {
    this.paused = p;
  }

  setSimTime(date: Date) {
    this.simTimeMs = date.getTime();
    this.lastTick = performance.now();
  }

  getSimDate(): Date {
    return new Date(this.simTimeMs);
  }

  onTimeUpdate(cb: (date: Date) => void): () => void {
    this.timeListeners.add(cb);
    return () => this.timeListeners.delete(cb);
  }

  start() {
    this.lastTick = performance.now();
    this.loop();
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const delta = now - this.lastTick;
    this.lastTick = now;
    if (!this.paused) {
      this.simTimeMs += delta * this.timeScale;
    }
    const currentDate = new Date(this.simTimeMs);
    this.updateScene(currentDate);
    this.renderer.render(this.scene, this.camera);
    for (const cb of this.timeListeners) {
      cb(currentDate);
    }
  };

  private updateScene(now: Date) {
    const jd = jdFromDate(now);

    // Earth
    {
      const [x, y, z] = propagate(this.earth.els, jd);
      this.earth.mesh!.position.set(x * SCALE, z * SCALE, y * SCALE);
    }

    // NEOs
    for (const b of this.bodies) {
      const [x, y, z] = propagate(b.els, jd);
      const pos = new THREE.Vector3(x * SCALE, z * SCALE, y * SCALE);
      if (b.mesh) {
        b.mesh.position.copy(pos);
      }
      if (b.trail) {
        const geo = b.trail.geometry as THREE.BufferGeometry;
        const attr = geo.attributes.position as THREE.BufferAttribute;
        const prev = new THREE.Vector3().fromBufferAttribute(attr, 1);
        attr.setXYZ(0, prev.x, prev.y, prev.z);
        attr.setXYZ(1, pos.x, pos.y, pos.z);
        attr.needsUpdate = true;
      }
    }
  }

  private onResize() {
    const host = this.opts.host;
    const w = host.clientWidth || 800;
    const h = host.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
