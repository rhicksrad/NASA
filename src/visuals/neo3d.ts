import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  jdFromDate,
  propagate,
  prepareKeplerian,
  type Keplerian,
  type PreparedKeplerian,
} from '../utils/orbit';

const SCALE = 120;
const SIZE_MULTIPLIER = 2;
const SMALL_BODY_SCALE = 3;
const DAY_MS = 86_400_000;
const TWO_PI = Math.PI * 2;
const WHITE = new THREE.Color(0xffffff);
const BLACK = new THREE.Color(0x000000);

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

function colorToHex(color: THREE.Color): string {
  return `#${color.getHexString()}`;
}

function lightenHex(color: THREE.Color, amount: number): string {
  return colorToHex(color.clone().lerp(WHITE, THREE.MathUtils.clamp(amount, 0, 1)));
}

function darkenHex(color: THREE.Color, amount: number): string {
  return colorToHex(color.clone().lerp(BLACK, THREE.MathUtils.clamp(amount, 0, 1)));
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) + 1;
}

function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = Math.sin(state) * 10000;
    return state - Math.floor(state);
  };
}

function createCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

type PlanetTexturePainter = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  base: THREE.Color,
  rand: () => number,
) => void;

function scatterBlotches(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  count: number,
  radiusRange: [number, number],
  color: string,
  alpha: number,
  rand: () => number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let i = 0; i < count; i += 1) {
    const radius = radiusRange[0] + rand() * (radiusRange[1] - radiusRange[0]);
    const x = rand() * width;
    const y = rand() * height;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * (0.75 + rand() * 0.35), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const paintGeneric: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.25));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.35));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  scatterBlotches(ctx, width, height, 400, [4, 24], darkenHex(base, 0.45), 0.12, rand);
};

const paintMercury: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  const gradient = ctx.createRadialGradient(
    width * 0.35,
    height * 0.3,
    width * 0.1,
    width * 0.5,
    height * 0.5,
    width * 0.65,
  );
  gradient.addColorStop(0, lightenHex(base, 0.35));
  gradient.addColorStop(0.45, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.6));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.68;
  for (let i = 0; i < 160; i += 1) {
    const r = width * (0.008 + rand() * 0.05);
    const x = rand() * width;
    const y = rand() * height;
    const crater = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    crater.addColorStop(0, lightenHex(base, 0.3 + rand() * 0.1));
    crater.addColorStop(0.6, colorToHex(base));
    crater.addColorStop(1, darkenHex(base, 0.75));
    ctx.fillStyle = crater;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  scatterBlotches(ctx, width, height, 1200, [1, 6], lightenHex(base, 0.15), 0.08, rand);
  scatterBlotches(ctx, width, height, 1200, [1, 5], darkenHex(base, 0.5), 0.1, rand);
};

const paintVenus: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.3));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.4));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  for (let i = 0; i < 220; i += 1) {
    const y = rand() * height;
    const thickness = height * (0.01 + rand() * 0.02);
    const curve = ctx.createLinearGradient(0, y, width, y + thickness);
    const tint = rand() * 0.25;
    curve.addColorStop(0, lightenHex(base, 0.25 + tint));
    curve.addColorStop(0.5, lightenHex(base, 0.15));
    curve.addColorStop(1, darkenHex(base, 0.3));
    ctx.globalAlpha = 0.08 + rand() * 0.1;
    ctx.fillStyle = curve;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= width; x += width / 16) {
      const offset = Math.sin((x / width) * Math.PI * 2 + rand() * Math.PI) * thickness * (0.6 + rand() * 0.4);
      ctx.lineTo(x, y + offset);
    }
    ctx.lineTo(width, y + thickness);
    ctx.lineTo(0, y + thickness * 1.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  scatterBlotches(ctx, width, height, 600, [3, 18], lightenHex(base, 0.4), 0.08, rand);
};

function drawLandmass(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rand: () => number,
  scale: number,
  color: string,
): void {
  const cx = width * (0.2 + rand() * 0.6);
  const cy = height * (0.2 + rand() * 0.6);
  const points = 8 + Math.floor(rand() * 7);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rand() - 0.5) * Math.PI * 1.6);
  ctx.scale(scale, scale * (0.7 + rand() * 0.45));
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    const radius = 80 + rand() * 90;
    const x = Math.cos(angle) * radius * (0.6 + rand() * 0.6);
    const y = Math.sin(angle) * radius * (0.6 + rand() * 0.6);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.quadraticCurveTo(x * 0.9, y * 0.9, x, y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.strokeStyle = 'rgba(241, 245, 249, 0.18)';
  ctx.lineWidth = 8;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

const paintEarth: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  const oceanTop = new THREE.Color(0x0b3d91);
  const oceanBottom = new THREE.Color(0x1d4ed8);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, colorToHex(oceanTop));
  gradient.addColorStop(0.6, colorToHex(oceanBottom));
  gradient.addColorStop(1, darkenHex(oceanBottom, 0.35));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const landColors = ['#22c55e', '#166534', '#bbf7d0'];
  for (let i = 0; i < 4; i += 1) {
    const color = landColors[i % landColors.length];
    drawLandmass(ctx, width, height, rand, 0.6 + rand() * 0.5, color);
  }

  ctx.save();
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 80; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const radius = width * (0.02 + rand() * 0.06);
    const cloud = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
    cloud.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    cloud.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = cloud;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * (0.4 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const polarTop = ctx.createRadialGradient(width / 2, 0, 0, width / 2, 0, width * 0.6);
  polarTop.addColorStop(0, 'rgba(241, 245, 249, 0.85)');
  polarTop.addColorStop(1, 'rgba(241, 245, 249, 0)');
  ctx.fillStyle = polarTop;
  ctx.fillRect(0, 0, width, height * 0.5);

  const polarBottom = ctx.createRadialGradient(width / 2, height, 0, width / 2, height, width * 0.6);
  polarBottom.addColorStop(0, 'rgba(241, 245, 249, 0.9)');
  polarBottom.addColorStop(1, 'rgba(241, 245, 249, 0)');
  ctx.fillStyle = polarBottom;
  ctx.fillRect(0, height * 0.5, width, height * 0.5);
};

const paintMars: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.25));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.45));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  scatterBlotches(ctx, width, height, 320, [10, 60], darkenHex(base, 0.6), 0.28, rand);
  scatterBlotches(ctx, width, height, 220, [12, 90], lightenHex(base, 0.18), 0.16, rand);

  ctx.save();
  ctx.globalAlpha = 0.4;
  for (let i = 0; i < 80; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const radius = width * (0.015 + rand() * 0.035);
    const storm = ctx.createRadialGradient(x, y, radius * 0.3, x, y, radius);
    storm.addColorStop(0, lightenHex(base, 0.3));
    storm.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = storm;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 1.8, radius, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const paintJupiter: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.3));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.4));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const bandCount = 14;
  for (let i = 0; i < bandCount; i += 1) {
    const y = (i / bandCount) * height;
    const bandHeight = height * (0.04 + rand() * 0.05);
    const stripe = ctx.createLinearGradient(0, y, 0, y + bandHeight);
    const tone = (i % 2 === 0 ? lightenHex(base, 0.28) : darkenHex(base, 0.3));
    stripe.addColorStop(0, tone);
    stripe.addColorStop(0.5, lightenHex(base, 0.12 + rand() * 0.08));
    stripe.addColorStop(1, darkenHex(base, 0.28));
    ctx.fillStyle = stripe;
    ctx.globalAlpha = 0.86;
    ctx.fillRect(0, y, width, bandHeight);
  }

  ctx.globalAlpha = 0.95;
  const spotX = width * 0.68;
  const spotY = height * 0.58;
  const spotRadiusX = width * 0.14;
  const spotRadiusY = height * 0.08;
  const spot = ctx.createRadialGradient(spotX, spotY, spotRadiusX * 0.25, spotX, spotY, spotRadiusX);
  spot.addColorStop(0, '#f97316');
  spot.addColorStop(0.6, '#ea580c');
  spot.addColorStop(1, 'rgba(234, 88, 12, 0)');
  ctx.fillStyle = spot;
  ctx.beginPath();
  ctx.ellipse(spotX, spotY, spotRadiusX, spotRadiusY, Math.PI / 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  scatterBlotches(ctx, width, height, 900, [4, 18], lightenHex(base, 0.2), 0.08, rand);
};

const paintSaturn: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.28));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.38));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 16; i += 1) {
    const y = (i / 16) * height;
    const bandHeight = height * (0.025 + rand() * 0.04);
    const stripe = ctx.createLinearGradient(0, y, 0, y + bandHeight);
    const mix = i % 2 === 0 ? lightenHex(base, 0.22) : darkenHex(base, 0.25);
    stripe.addColorStop(0, mix);
    stripe.addColorStop(0.5, lightenHex(base, 0.12));
    stripe.addColorStop(1, darkenHex(base, 0.32));
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = stripe;
    ctx.fillRect(0, y, width, bandHeight);
  }

  scatterBlotches(ctx, width, height, 600, [6, 20], lightenHex(base, 0.2), 0.06, rand);
};

const paintIceGiant = (tone: THREE.Color): PlanetTexturePainter => (ctx, width, height, _base, rand) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(tone, 0.25));
  gradient.addColorStop(0.5, colorToHex(tone));
  gradient.addColorStop(1, darkenHex(tone, 0.35));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalAlpha = 0.28;
  for (let i = 0; i < 120; i += 1) {
    const y = rand() * height;
    const radius = width * (0.03 + rand() * 0.05);
    const streak = ctx.createLinearGradient(0, y, width, y + radius * 0.2);
    streak.addColorStop(0, lightenHex(tone, 0.4));
    streak.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = streak;
    ctx.beginPath();
    ctx.ellipse(width / 2, y, width * 0.6, radius * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const paintPluto: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.25));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.45));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  scatterBlotches(ctx, width, height, 420, [8, 48], lightenHex(base, 0.3), 0.18, rand);
  scatterBlotches(ctx, width, height, 380, [6, 36], darkenHex(base, 0.6), 0.22, rand);

  ctx.save();
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 6; i += 1) {
    const x = width * (0.2 + rand() * 0.6);
    const y = height * (0.2 + rand() * 0.6);
    const radiusX = width * (0.08 + rand() * 0.12);
    const radiusY = height * (0.05 + rand() * 0.1);
    const patch = ctx.createRadialGradient(x, y, radiusX * 0.2, x, y, radiusX);
    patch.addColorStop(0, lightenHex(base, 0.4));
    patch.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = patch;
    ctx.beginPath();
    ctx.ellipse(x, y, radiusX, radiusY, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const PLANET_PAINTERS: Record<string, PlanetTexturePainter> = {
  mercury: paintMercury,
  venus: paintVenus,
  earth: paintEarth,
  mars: paintMars,
  jupiter: paintJupiter,
  saturn: paintSaturn,
  uranus: paintIceGiant(new THREE.Color(0x3ba7d4)),
  neptune: paintIceGiant(new THREE.Color(0x1e40af)),
  pluto: paintPluto,
};

function applyPlanetHighlights(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  base: THREE.Color,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const highlight = ctx.createRadialGradient(
    width * 0.25,
    height * 0.3,
    width * 0.05,
    width * 0.35,
    height * 0.4,
    width * 0.6,
  );
  highlight.addColorStop(0, lightenHex(base, 0.45));
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = 'multiply';
  const shadow = ctx.createRadialGradient(
    width * 0.8,
    height * 0.7,
    width * 0.1,
    width * 0.9,
    height * 0.8,
    width * 0.95,
  );
  shadow.addColorStop(0, 'rgba(0, 0, 0, 0.2)');
  shadow.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function createPlanetTexture(name: string, baseColor: number): THREE.Texture | null {
  const canvas = createCanvas(1024, 512);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const key = name.trim().toLowerCase();
  const base = new THREE.Color(baseColor);
  const painter = PLANET_PAINTERS[key] ?? paintGeneric;
  const rand = createSeededRandom(hashString(name || 'planet'));
  painter(ctx, canvas.width, canvas.height, base, rand);
  applyPlanetHighlights(ctx, canvas.width, canvas.height, base);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createPlanetMaterial(name: string, baseColor: number): THREE.MeshStandardMaterial {
  const texture = createPlanetTexture(name, baseColor);
  const options: THREE.MeshStandardMaterialParameters = {
    color: baseColor,
    metalness: 0.2,
    roughness: 0.65,
  };

  if (texture) {
    options.map = texture;
  }

  const lower = name.trim().toLowerCase();
  if (lower === 'mercury') {
    options.roughness = 0.85;
    options.metalness = 0.1;
  } else if (lower === 'venus') {
    options.roughness = 0.82;
    options.metalness = 0.12;
  } else if (lower === 'earth') {
    options.roughness = 0.55;
    options.metalness = 0.25;
    options.emissive = new THREE.Color(0x0f172a).multiplyScalar(0.25);
  } else if (lower === 'mars') {
    options.roughness = 0.7;
    options.metalness = 0.18;
  } else if (lower === 'jupiter' || lower === 'saturn') {
    options.roughness = 0.58;
    options.metalness = 0.12;
  } else if (lower === 'uranus' || lower === 'neptune') {
    options.roughness = 0.48;
    options.metalness = 0.2;
  } else if (lower === 'pluto') {
    options.roughness = 0.75;
    options.metalness = 0.1;
  }

  return new THREE.MeshStandardMaterial(options);
}

function createSaturnRings(radius: number): THREE.Mesh | null {
  const canvas = createCanvas(1024, 64);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(0.1, 'rgba(249, 250, 252, 0.2)');
  gradient.addColorStop(0.25, 'rgba(253, 224, 171, 0.45)');
  gradient.addColorStop(0.45, 'rgba(248, 191, 132, 0.6)');
  gradient.addColorStop(0.6, 'rgba(249, 250, 252, 0.4)');
  gradient.addColorStop(0.75, 'rgba(229, 231, 235, 0.25)');
  gradient.addColorStop(0.92, 'rgba(255, 255, 255, 0.05)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
  for (let i = 0; i < 9; i += 1) {
    const gapX = canvas.width * (0.1 + 0.08 * i + Math.pow(-1, i) * 0.01);
    const gapWidth = canvas.width * (0.01 + (i % 3) * 0.005);
    ctx.fillRect(gapX, 0, gapWidth, canvas.height);
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;

  const inner = radius * SIZE_MULTIPLIER * SCALE * 1.6;
  const outer = radius * SIZE_MULTIPLIER * SCALE * 2.9;
  const geometry = new THREE.RingGeometry(inner, outer, 180, 1);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    metalness: 0.2,
    roughness: 0.7,
    opacity: 0.95,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  mesh.rotation.z = THREE.MathUtils.degToRad(26.7);
  return mesh;
}

function createSmallBodyTexture(spec: SmallBodySpec, shape: 'comet' | 'asteroid'): THREE.Texture | null {
  const canvas = createCanvas(256, 256);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const seedKey = `${spec.id ?? spec.name ?? shape}`;
  const rand = createSeededRandom(hashString(seedKey));
  const base = new THREE.Color(spec.color);

  ctx.fillStyle = shape === 'comet' ? darkenHex(base, 0.55) : darkenHex(base, 0.35);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  scatterBlotches(
    ctx,
    canvas.width,
    canvas.height,
    shape === 'comet' ? 120 : 260,
    [shape === 'comet' ? 8 : 4, shape === 'comet' ? 42 : 26],
    lightenHex(base, shape === 'comet' ? 0.35 : 0.2),
    0.22,
    rand,
  );

  scatterBlotches(
    ctx,
    canvas.width,
    canvas.height,
    shape === 'comet' ? 90 : 180,
    [shape === 'comet' ? 10 : 6, shape === 'comet' ? 52 : 32],
    darkenHex(base, shape === 'comet' ? 0.65 : 0.55),
    0.25,
    rand,
  );

  if (shape === 'comet') {
    ctx.save();
    ctx.globalAlpha = 0.4;
    const streaks = 18;
    for (let i = 0; i < streaks; i += 1) {
      const y = rand() * canvas.height;
      const length = canvas.width * (0.2 + rand() * 0.4);
      const gradient = ctx.createLinearGradient(0, y, length, y);
      gradient.addColorStop(0, 'rgba(226, 232, 240, 0.75)');
      gradient.addColorStop(1, 'rgba(226, 232, 240, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, y, length, 2 + rand() * 4);
    }
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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

function buildOrbitPoints(
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

function createPlanetMesh(
  provider: PlanetSampleProvider,
): { mesh: THREE.Mesh; extras: THREE.Object3D[] } {
  const radius = provider.radius ?? 0.03;
  const geometry = new THREE.SphereGeometry(radius * SIZE_MULTIPLIER * SCALE, 64, 48);
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

function inferSmallBodyShape(spec: SmallBodySpec): 'comet' | 'asteroid' {
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

function createBodyMesh(spec: SmallBodySpec): THREE.Mesh {
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
    const deltaDays = 1 / 2880; // ~30 seconds
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
