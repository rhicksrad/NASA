import * as THREE from 'three';
import { jdFromDate, propagate, earthElementsApprox, type Keplerian } from '../utils/orbit';

const SCALE = 120;             // scene units per AU (bigger)
const SUN_R   = 0.12 * SCALE;  // ~14 units
const EARTH_R = 0.03 * SCALE;  // ~3.6 units

export interface Body { name: string; els: Keplerian; color: number; mesh?: THREE.Object3D; trail?: THREE.Line; }
export interface Neo3DOptions { host: HTMLElement; }

export class Neo3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private earth: Body;
  private bodies: Body[] = [];
  private t = Date.now();
  private dtMult = 600;       // fast by default so motion is obvious
  private paused = false;

  constructor(private opts: Neo3DOptions){
    const { host } = opts;
    const w = host.clientWidth || 800, h = host.clientHeight || 520;

    // renderer + background
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    host.replaceChildren(this.renderer.domElement);
    this.renderer.setClearColor(0x0b3d91, 1);  // NASA blue background

    // camera
    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100000);
    this.camera.position.set(0, 2.2 * SCALE, 3.2 * SCALE);
    this.camera.lookAt(0, 0, 0);

    // lights
    const amb = new THREE.AmbientLight(0xffffff, 0.7);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(3 * SCALE, 4 * SCALE, 2 * SCALE);
    this.scene.add(amb, dir);

    // sun (bright + emissive so it’s obvious)
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_R, 48, 32),
      new THREE.MeshPhongMaterial({ color: 0xffe066, emissive: 0xffd166, emissiveIntensity: 0.8 })
    );
    this.scene.add(sun);

    // earth
    this.earth = { name: 'Earth', els: earthElementsApprox(), color: 0x64b5f6 };
    const earthMesh = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R, 48, 32),
      new THREE.MeshPhongMaterial({ color: this.earth.color })
    );
    this.earth.mesh = earthMesh;
    this.scene.add(earthMesh);

    // earth orbit ring (thick and high-contrast)
    const N = 256;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * SCALE, 0, Math.sin(a) * SCALE));
    }
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
    );
    this.scene.add(ring);

    // subtle grid so you can see the ecliptic plane
    const grid = new THREE.GridHelper(3 * SCALE, 24, 0xd9e3f0, 0x4267b2);
    (grid.material as THREE.Material).opacity = 0.25;
    (grid.material as THREE.Material).transparent = true;
    this.scene.add(grid);

    window.addEventListener('resize', () => this.onResize());
  }

  addBodies(list: Body[]){
    for (const b of list) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.012 * SCALE, 20, 14),
        new THREE.MeshPhongMaterial({ color: b.color })
      );
      const trail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: 0.7 })
      );
      b.mesh = mesh; b.trail = trail;
      this.scene.add(mesh, trail);
      this.bodies.push(b);
    }
    this.autoFrame();
  }

  setTimeScale(m: number){ this.dtMult = m; }
  setPaused(p: boolean){ this.paused = p; }

  start(){
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.paused) this.t += 16 * this.dtMult;
      this.update(new Date(this.t));
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private update(now: Date){
    const jd = jdFromDate(now);

    // Earth
    {
      const [x, y, z] = propagate(this.earth.els, jd);
      // Map ecliptic XYZ -> three.js X (right), Y (up), Z (forward)
      this.earth.mesh!.position.set(x * SCALE, z * SCALE, y * SCALE);
    }

    // NEOs
    for (const b of this.bodies) {
      const [x, y, z] = propagate(b.els, jd);
      const pos = new THREE.Vector3(x * SCALE, z * SCALE, y * SCALE);
      b.mesh!.position.copy(pos);
      const geo = b.trail!.geometry as THREE.BufferGeometry;
      const arr = geo.getAttribute('position') as THREE.BufferAttribute;
      const prev = new THREE.Vector3().fromBufferAttribute(arr, 1);
      arr.setXYZ(0, prev.x, prev.y, prev.z);
      arr.setXYZ(1, pos.x, pos.y, pos.z);
      arr.needsUpdate = true;
    }
  }

  private autoFrame(){
    // Fit camera to all bodies + Sun/Earth
    const pts: THREE.Vector3[] = [];
    pts.push(new THREE.Vector3(0, 0, 0)); // Sun
    if (this.earth.mesh) pts.push((this.earth.mesh as THREE.Mesh).position.clone());
    for (const b of this.bodies) if (b.mesh) pts.push((b.mesh as THREE.Mesh).position.clone());
    const bs = new THREE.Sphere();
    new THREE.Box3().setFromPoints(pts).getBoundingSphere(bs);

    const r = Math.max(bs.radius, 1 * SCALE);
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.position.set(bs.center.x + dist * 0.2, bs.center.y + dist * 0.5, bs.center.z + dist * 0.8);
    this.camera.near = Math.max(0.1, dist * 0.001);
    this.camera.far = dist * 50;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(bs.center);
  }

  private onResize(){
    const host = this.opts.host;
    const w = host.clientWidth || 800, h = host.clientHeight || 520;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
