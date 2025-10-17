import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { jdFromDate, propagate, earthElementsApprox, type Keplerian } from '../utils/orbit';

const SCALE = 120, SUN_R = 0.12 * SCALE, EARTH_R = 0.03 * SCALE;
const SPRITE_SIZE = 0.24 * SCALE;
const GAUSS_K = 0.01720209895; // sqrt(GM_sun) AU^(3/2)/day

type GradientStop = {
  offset: number;
  color: string;
  alpha?: number;
};

interface SpriteSpec {
  radius: number;
  name: string;
  stops: GradientStop[];
}

const PLANET_SPRITES: SpriteSpec[] = [
  {
    name: 'Mercury',
    radius: 0.6 * SCALE,
    stops: [
      { offset: 0, color: '#c3b7a6' },
      { offset: 0.65, color: '#8b8071' },
      { offset: 1, color: '#6f6558' }
    ]
  },
  {
    name: 'Venus',
    radius: 0.85 * SCALE,
    stops: [
      { offset: 0, color: '#f1d6a2' },
      { offset: 0.55, color: '#e9b26b' },
      { offset: 1, color: '#c97c28' }
    ]
  },
  {
    name: 'Earth',
    radius: 1 * SCALE,
    stops: [
      { offset: 0, color: '#3a7bd5' },
      { offset: 0.55, color: '#00d2ff' },
      { offset: 1, color: '#2a5298' }
    ]
  },
  {
    name: 'Mars',
    radius: 1.45 * SCALE,
    stops: [
      { offset: 0, color: '#ffb347' },
      { offset: 0.6, color: '#f26b38' },
      { offset: 1, color: '#a83f24' }
    ]
  },
  {
    name: 'Jupiter',
    radius: 2.2 * SCALE,
    stops: [
      { offset: 0, color: '#f4d19d' },
      { offset: 0.35, color: '#cfa57a' },
      { offset: 0.65, color: '#b07d62' },
      { offset: 1, color: '#8c5947' }
    ]
  },
  {
    name: 'Saturn',
    radius: 2.75 * SCALE,
    stops: [
      { offset: 0, color: '#f7e6b8' },
      { offset: 0.5, color: '#d9b77b' },
      { offset: 1, color: '#a68254' }
    ]
  },
  {
    name: 'Uranus',
    radius: 3.25 * SCALE,
    stops: [
      { offset: 0, color: '#a5f3ff' },
      { offset: 0.55, color: '#60d5f7' },
      { offset: 1, color: '#2fa2cf' }
    ]
  },
  {
    name: 'Neptune',
    radius: 3.7 * SCALE,
    stops: [
      { offset: 0, color: '#b0cfff' },
      { offset: 0.5, color: '#4f72ff' },
      { offset: 1, color: '#2430a4' }
    ]
  }
];

function createGradientTexture(stops: GradientStop[], size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to acquire canvas context for gradient sprite.');
  }

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const stop of stops) {
    const alpha = stop.alpha ?? 1;
    const color = new THREE.Color(stop.color);
    gradient.addColorStop(
      stop.offset,
      `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${alpha})`
    );
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createPlanetSprite(spec: SpriteSpec): THREE.Sprite {
  const texture = createGradientTexture(spec.stops, 768);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0.95 });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(SPRITE_SIZE);
  sprite.position.set(spec.radius, 0, 0);
  sprite.name = spec.name;
  return sprite;
}

function createSunGlow(radius: number): THREE.Sprite {
  const texture = createGradientTexture([
    { offset: 0, color: '#fff5cc', alpha: 1 },
    { offset: 0.55, color: '#ffd166', alpha: 0.7 },
    { offset: 1, color: '#ff7f50', alpha: 0 }
  ]);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(radius * 6);
  return sprite;
}

function buildOrbitRing(radius: number, color = 0xd9e3f0): THREE.Line {
  const segments = 256;
  const points: THREE.Vector3[] = [];
  for (let k = 0; k <= segments; k++) {
    const angle = (k / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 });
  return new THREE.Line(geometry, material);
}

function createStarfield(radius: number, density = 1400): THREE.Points {
  const positions = new Float32Array(density * 3);
  for (let i = 0; i < density; i++) {
    const r = radius * (0.4 + Math.random() * 0.6);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const sinPhi = Math.sin(phi);
    positions[i * 3] = r * sinPhi * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * sinPhi * Math.sin(theta);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.06 * SCALE,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true
  });
  return new THREE.Points(geometry, material);
}

function createLabelSprite(text: string, color = '#f8fafc'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const width = 512;
  const height = 256;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to acquire canvas context for label sprite.');
  }

  ctx.clearRect(0, 0, width, height);
  ctx.font = '64px "Inter", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 6;
  ctx.fillText(text, width / 2, height - 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);

  const targetWidth = 0.6 * SCALE;
  const aspect = height === 0 ? 1 : width / height;
  const targetHeight = targetWidth / aspect;
  sprite.scale.set(targetWidth, targetHeight, 1);
  return sprite;
}

function buildOrbitPoints(els: Keplerian, segments: number, spanOverride?: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  if (segments < 2) {
    return points;
  }

  if (els.e < 1) {
    const aAbs = Math.abs(els.a);
    const periodDays = (2 * Math.PI * Math.sqrt(aAbs * aAbs * aAbs)) / GAUSS_K;
    for (let i = 0; i <= segments; i += 1) {
      const jd = els.epochJD + (periodDays * i) / segments;
      const [x, y, z] = propagate(els, jd);
      points.push(new THREE.Vector3(x * SCALE, z * SCALE, y * SCALE));
    }
  } else {
    const spanDays = spanOverride ?? 2200;
    const half = spanDays / 2;
    for (let i = 0; i <= segments; i += 1) {
      const offset = -half + (spanDays * i) / segments;
      const [x, y, z] = propagate(els, els.epochJD + offset);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        continue;
      }
      points.push(new THREE.Vector3(x * SCALE, z * SCALE, y * SCALE));
    }
  }

  return points;
}

interface OrbitConfig {
  color: number;
  segments?: number;
  spanDays?: number;
}

export interface Body {
  name: string;
  els: Keplerian;
  color: number;
  orbit?: OrbitConfig;
  label?: string;
  mesh?: THREE.Object3D;
  trail?: THREE.Line;
  orbitPath?: THREE.Line | THREE.LineLoop;
  labelSprite?: THREE.Sprite;
}
export interface Neo3DOptions { host: HTMLElement; dateLabel?: HTMLElement | null; }

export class Neo3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private earth: Body;
  private bodies: Body[] = [];
  private decorativePlanets = new THREE.Group();
  private simMs = Date.now();       // simulated UTC ms
  private dtMult = 86400;           // seconds of sim-time per real second (1 day/s)
  private paused = false;

  constructor(private opts: Neo3DOptions){
    const { host } = opts;
    const w = host.clientWidth || 800, h = host.clientHeight || 520;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.replaceChildren(this.renderer.domElement);
    this.renderer.setClearColor(0x01030e, 1);

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100000);
    this.camera.position.set(0, 2.8 * SCALE, 3.6 * SCALE);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.05;
    this.controls.enablePan = true; this.controls.enableZoom = true;
    this.controls.minDistance = 0.6 * SCALE;
    this.controls.maxDistance = 18 * SCALE;

    const starfield = createStarfield(26 * SCALE, 2200);
    this.scene.add(starfield);

    const amb = new THREE.AmbientLight(0xffffff, 0.45);
    const sunLight = new THREE.PointLight(0xfff4cf, 2, 0, 2);
    sunLight.position.set(0, 0, 0);
    this.scene.add(amb, sunLight);

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_R, 64, 48),
      new THREE.MeshBasicMaterial({ color: 0xfff1b0 })
    );
    const sunGlow = createSunGlow(SUN_R);
    sunGlow.position.set(0, 0, 0);
    this.scene.add(sun, sunGlow);

    this.scene.add(this.decorativePlanets);
    for (const spec of PLANET_SPRITES) {
      const ring = buildOrbitRing(spec.radius, spec.name === 'Earth' ? 0xffffff : 0x7083ff);
      const ringMaterial = ring.material as THREE.LineBasicMaterial;
      ringMaterial.opacity = spec.name === 'Earth' ? 0.65 : 0.35;
      ringMaterial.transparent = true;
      this.decorativePlanets.add(ring);
      if (spec.name !== 'Earth') {
        const sprite = createPlanetSprite(spec);
        sprite.scale.setScalar(spec.name === 'Jupiter' ? SPRITE_SIZE * 1.4 : spec.name === 'Saturn' ? SPRITE_SIZE * 1.3 : spec.name === 'Mercury' ? SPRITE_SIZE * 0.7 : spec.name === 'Venus' ? SPRITE_SIZE * 0.9 : spec.name === 'Mars' ? SPRITE_SIZE * 0.8 : spec.name === 'Uranus' || spec.name === 'Neptune' ? SPRITE_SIZE : SPRITE_SIZE * 0.95);
        this.decorativePlanets.add(sprite);
      }
    }

    this.earth = { name: 'Earth', els: earthElementsApprox(), color: 0x64b5f6 };
    const earthMesh = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R, 64, 48),
      new THREE.MeshStandardMaterial({
        color: this.earth.color,
        emissive: 0x0d2c61,
        roughness: 0.25,
        metalness: 0.05
      })
    );
    const earthSprite = createPlanetSprite(PLANET_SPRITES.find((p) => p.name === 'Earth')!);
    earthSprite.scale.setScalar(SPRITE_SIZE * 0.95);
    earthSprite.position.set(0, 0, 0);
    earthMesh.add(earthSprite);
    this.earth.mesh = earthMesh; this.scene.add(earthMesh);

    window.addEventListener('resize', ()=>this.onResize());
    document.addEventListener('visibilitychange', ()=>{
      if (document.hidden) { this.paused = true; }
      else { this.clock.stop(); this.clock.start(); this.paused = false; }  // resume cleanly
    });
  }

  addBodies(list: Body[]){
    const currentJd = jdFromDate(new Date(this.simMs));
    for(const b of list){
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.012 * SCALE, 24, 18),
        new THREE.MeshStandardMaterial({
          color: b.color,
          emissive: new THREE.Color(b.color).multiplyScalar(0.25),
          roughness: 0.3,
          metalness: 0.1
        })
      );
      mesh.name = b.name;

      if (b.label) {
        const label = createLabelSprite(b.label, '#fca5a5');
        label.position.set(0, 0.12 * SCALE, 0);
        mesh.add(label);
        b.labelSprite = label;
      }

      if (b.orbit) {
        const segments = Math.max(16, b.orbit.segments ?? 720);
        const points = buildOrbitPoints(b.els, segments, b.orbit.spanDays);
        if (points.length >= 2) {
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const material = new THREE.LineBasicMaterial({
            color: b.orbit.color,
            transparent: true,
            opacity: 0.7,
            linewidth: 1.4,
          });
          const orbitLine = b.els.e < 1 && points.length >= 3
            ? new THREE.LineLoop(geometry, material)
            : new THREE.Line(geometry, material);
          orbitLine.renderOrder = 1;
          b.orbitPath = orbitLine;
          this.scene.add(orbitLine);
        }
      }

      const trail = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: 0.55, linewidth: 1.2 })
      );
      const [x,y,z]=propagate(b.els,currentJd);
      const pos=new THREE.Vector3(x*SCALE,z*SCALE,y*SCALE);
      mesh.position.copy(pos);
      const g=trail.geometry as THREE.BufferGeometry;
      const arr=g.getAttribute('position') as THREE.BufferAttribute;
      arr.setXYZ(0,pos.x,pos.y,pos.z);
      arr.setXYZ(1,pos.x,pos.y,pos.z);
      arr.needsUpdate=true;

      b.mesh = mesh; b.trail = trail; this.scene.add(mesh, trail); this.bodies.push(b);
    }
  }

  setEarthElements(els: Keplerian){
    this.earth.els = els;
  }

  setTimeScale(m:number){ this.dtMult = m; }
  setPaused(p:boolean){
    this.paused = p;
    if (!p) { this.clock.stop(); this.clock.start(); } // reset delta to avoid jump
  }

  start(){
    this.clock.start();
    const loop = () => {
      requestAnimationFrame(loop);
      const realSec = this.clock.getDelta();
      if (!this.paused) {
        this.simMs += realSec * 1000 * this.dtMult;         // advance simulated ms
      }
      this.update(new Date(this.simMs), this.paused ? 0 : realSec);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private update(now:Date, realDelta:number){
    const jd = jdFromDate(now);
    const dateLabel = this.opts.dateLabel;
    if (dateLabel) dateLabel.textContent = now.toISOString().slice(0,19).replace('T',' ');

    if (realDelta > 0) {
      const rotationBoost = THREE.MathUtils.lerp(0.008, 0.045, THREE.MathUtils.clamp(this.dtMult / 86400, 0, 1));
      this.decorativePlanets.rotation.y += rotationBoost * realDelta;
    }

    { const [x,y,z]=propagate(this.earth.els,jd); this.earth.mesh!.position.set(x*SCALE, z*SCALE, y*SCALE); }
    for(const b of this.bodies){
      const [x,y,z]=propagate(b.els,jd);
      const pos=new THREE.Vector3(x*SCALE,z*SCALE,y*SCALE);
      b.mesh!.position.copy(pos);
      const g=b.trail!.geometry as THREE.BufferGeometry;
      const arr=g.getAttribute('position') as THREE.BufferAttribute;
      const prev=new THREE.Vector3().fromBufferAttribute(arr,1);
      arr.setXYZ(0,prev.x,prev.y,prev.z); arr.setXYZ(1,pos.x,pos.y,pos.z); arr.needsUpdate=true;
    }
  }

  private onResize(){
    const host=this.opts.host, w=host.clientWidth||800, h=host.clientHeight||520;
    this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix();
  }
}
