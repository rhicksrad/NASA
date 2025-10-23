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

function wrapXPositions(
  width: number,
  centerX: number,
  radius: number,
  draw: (wrappedX: number) => void,
): void {
  const bounds = Math.max(radius, 0);
  const offsets = [-width, 0, width];
  for (const offset of offsets) {
    const xPos = centerX + offset;
    if (xPos + bounds < 0 || xPos - bounds > width) continue;
    draw(xPos);
  }
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
  for (let i = 0; i < count; i += 1) {
    const radius = radiusRange[0] + rand() * (radiusRange[1] - radiusRange[0]);
    const x = rand() * width;
    const y = rand() * height;
    const angle = rand() * Math.PI;
    const eccentricity = 0.75 + rand() * 0.35;
    const wrapRadius = radius * (1 + eccentricity);
    wrapXPositions(width, x, wrapRadius, (wrappedX) => {
      const gradient = ctx.createRadialGradient(wrappedX, y, 0, wrappedX, y, radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.7, color);
      gradient.addColorStop(1, `${color}00`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(wrappedX, y, radius, radius * eccentricity, angle, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();
}

const paintGeneric: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.35));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.45));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  scatterBlotches(ctx, width, height, 800, [3, 28], darkenHex(base, 0.5), 0.18, rand);
  scatterBlotches(ctx, width, height, 600, [2, 20], lightenHex(base, 0.25), 0.12, rand);
};

const paintMercury: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  // Base with radial gradient for sphere effect
  const bgGrad = ctx.createRadialGradient(
    width * 0.35,
    height * 0.3,
    width * 0.05,
    width * 0.5,
    height * 0.5,
    width * 0.75,
  );
  bgGrad.addColorStop(0, lightenHex(base, 0.45));
  bgGrad.addColorStop(0.4, colorToHex(base));
  bgGrad.addColorStop(1, darkenHex(base, 0.7));
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Large craters with detailed rims
  ctx.save();
  for (let i = 0; i < 250; i += 1) {
    const r = width * (0.01 + rand() * 0.08);
    const x = rand() * width;
    const y = rand() * height;
    
    // Crater floor
    const crater = ctx.createRadialGradient(x, y, 0, x, y, r);
    crater.addColorStop(0, darkenHex(base, 0.8));
    crater.addColorStop(0.5, darkenHex(base, 0.6));
    crater.addColorStop(0.85, colorToHex(base));
    crater.addColorStop(1, lightenHex(base, 0.35));
    ctx.fillStyle = crater;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    
    // Bright rim highlight
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = lightenHex(base, 0.4);
    ctx.lineWidth = r * 0.15;
    ctx.stroke();
  }
  ctx.restore();

  // Smaller impact craters
  scatterBlotches(ctx, width, height, 2000, [1, 8], darkenHex(base, 0.65), 0.4, rand);
  scatterBlotches(ctx, width, height, 1500, [1, 5], lightenHex(base, 0.2), 0.15, rand);

  // Surface texture variation
  scatterBlotches(ctx, width, height, 3000, [2, 12], darkenHex(base, 0.3), 0.08, rand);
};

const paintVenus: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  // Thick atmospheric base
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.4));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.45));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Multiple cloud layers creating swirling patterns
  ctx.save();
  for (let layer = 0; layer < 5; layer += 1) {
    const layerAlpha = 0.08 + layer * 0.04;
    for (let i = 0; i < 300; i += 1) {
      const y = rand() * height;
      const thickness = height * (0.008 + rand() * 0.025);
      const waveCount = 3 + Math.floor(rand() * 4);
      
      const curve = ctx.createLinearGradient(0, y, width, y + thickness);
      const tint = rand() * 0.3;
      curve.addColorStop(0, lightenHex(base, 0.3 + tint));
      curve.addColorStop(0.5, lightenHex(base, 0.15));
      curve.addColorStop(1, darkenHex(base, 0.35));
      
      ctx.globalAlpha = layerAlpha + rand() * 0.12;
      ctx.fillStyle = curve;
      ctx.beginPath();
      ctx.moveTo(0, y);
      
      for (let x = 0; x <= width; x += width / 24) {
        const angle = (x / width) * Math.PI * waveCount + rand() * Math.PI + layer;
        const offset = Math.sin(angle) * thickness * (0.8 + rand() * 0.6);
        ctx.lineTo(x, y + offset);
      }
      
      ctx.lineTo(width, y + thickness * 1.5);
      ctx.lineTo(0, y + thickness * 1.5);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();

  // Atmospheric turbulence
  scatterBlotches(ctx, width, height, 1000, [4, 24], lightenHex(base, 0.45), 0.1, rand);
  scatterBlotches(ctx, width, height, 800, [3, 18], darkenHex(base, 0.25), 0.08, rand);
};

type EarthSplinePoint = { x: number; y: number; cpx?: number; cpy?: number };

type EarthContinentConfig = {
  center: { x: number; y: number };
  scale: number;
  aspect?: number;
  rotation?: number;
  fillStops: { offset: number; color: string }[];
  fillAlpha?: number;
  coastline?: string;
  coastlineAlpha?: number;
  coastlineWidth?: number;
  points: EarthSplinePoint[];
  decorate?: (
    ctx: CanvasRenderingContext2D,
    rand: () => number,
    scaleX: number,
    scaleY: number,
  ) => void;
};

const EARTH_BASE_RADIUS = 256;

function createEarthPath(points: EarthSplinePoint[]): Path2D | null {
  if (typeof Path2D !== 'function') return null;
  const path = new Path2D();
  if (!points.length) return path;

  const [{ x: startX, y: startY }] = points;
  path.moveTo(startX, startY);
  for (let i = 1; i < points.length; i += 1) {
    const { x, y, cpx, cpy } = points[i];
    if (cpx != null && cpy != null) {
      path.quadraticCurveTo(cpx, cpy, x, y);
    } else {
      path.lineTo(x, y);
    }
  }
  path.closePath();
  return path;
}

function traceEarthPath(ctx: CanvasRenderingContext2D, points: EarthSplinePoint[]): void {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const { x, y, cpx, cpy } = points[i];
    if (cpx != null && cpy != null) {
      ctx.quadraticCurveTo(cpx, cpy, x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
}

function applyEarthPath(
  ctx: CanvasRenderingContext2D,
  path: Path2D | null,
  points: EarthSplinePoint[],
  action: 'fill' | 'stroke' | 'clip',
): void {
  if (path) {
    if (action === 'fill') {
      ctx.fill(path);
    } else if (action === 'stroke') {
      ctx.stroke(path);
    } else {
      ctx.clip(path);
    }
    return;
  }

  traceEarthPath(ctx, points);
  if (action === 'fill') {
    ctx.fill();
  } else if (action === 'stroke') {
    ctx.stroke();
  } else {
    ctx.clip();
  }
}

function drawEarthContinent(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  globalRand: () => number,
  config: EarthContinentConfig,
): void {
  if (!config.points.length) return;

  const path = createEarthPath(config.points);
  const centerX = width * config.center.x;
  const centerY = height * config.center.y;
  const baseSize = Math.min(width, height);
  const scaleX = (baseSize / (EARTH_BASE_RADIUS * 2)) * config.scale;
  const scaleY = scaleX * (config.aspect ?? 1);
  const rotation = config.rotation ?? 0;
  const extent = EARTH_BASE_RADIUS * Math.max(scaleX, scaleY);
  const detailSeed = globalRand() * 1000 + config.center.x * 100 + config.center.y * 100;

  wrapXPositions(width, centerX, extent, (wrappedX) => {
    const localRand = createSeededRandom(detailSeed);
    ctx.save();
    ctx.translate(wrappedX, centerY);
    if (rotation !== 0) ctx.rotate(rotation);
    ctx.scale(scaleX, scaleY);

    const gradient = ctx.createLinearGradient(-220, -220, 200, 240);
    config.fillStops.forEach(({ offset, color }) => gradient.addColorStop(offset, color));
    ctx.fillStyle = gradient;
    ctx.globalAlpha = config.fillAlpha ?? 0.98;
    applyEarthPath(ctx, path, config.points, 'fill');
    ctx.globalAlpha = 1;

    if (config.decorate) {
      ctx.save();
      applyEarthPath(ctx, path, config.points, 'clip');
      config.decorate(ctx, localRand, scaleX, scaleY);
      ctx.restore();
    }

    if (config.coastline) {
      ctx.strokeStyle = config.coastline;
      ctx.lineWidth = (config.coastlineWidth ?? 8) / Math.max(scaleX, scaleY);
      ctx.globalAlpha = config.coastlineAlpha ?? 0.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      applyEarthPath(ctx, path, config.points, 'stroke');
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  });
}

const paintEarth: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  // Deep ocean with gradient
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, height);
  oceanGrad.addColorStop(0, '#0a4d8c');
  oceanGrad.addColorStop(0.5, '#0b3d91');
  oceanGrad.addColorStop(1, '#1d4ed8');
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, width, height);

  // Ocean depth variation
  scatterBlotches(ctx, width, height, 500, [20, 80], '#082f5c', 0.2, rand);

  const eurasiaPoints: EarthSplinePoint[] = [
    { x: -220, y: -60 },
    { x: -160, y: -170, cpx: -260, cpy: -130 },
    { x: -40, y: -210, cpx: -140, cpy: -220 },
    { x: 120, y: -190, cpx: 20, cpy: -220 },
    { x: 210, y: -120, cpx: 200, cpy: -190 },
    { x: 220, y: -10, cpx: 240, cpy: -70 },
    { x: 170, y: 70, cpx: 220, cpy: 40 },
    { x: 110, y: 120, cpx: 150, cpy: 110 },
    { x: 60, y: 170, cpx: 100, cpy: 150 },
    { x: 10, y: 210, cpx: 40, cpy: 200 },
    { x: -40, y: 190, cpx: -10, cpy: 210 },
    { x: -70, y: 130, cpx: -90, cpy: 170 },
    { x: -120, y: 60, cpx: -130, cpy: 110 },
    { x: -160, y: 20, cpx: -150, cpy: 40 },
    { x: -200, y: 10, cpx: -190, cpy: 0 },
    { x: -230, y: -20, cpx: -220, cpy: 0 },
    { x: -220, y: -60, cpx: -240, cpy: -40 },
  ];

  const northAmericaPoints: EarthSplinePoint[] = [
    { x: -250, y: -60 },
    { x: -220, y: -160, cpx: -280, cpy: -150 },
    { x: -120, y: -210, cpx: -200, cpy: -220 },
    { x: -40, y: -180, cpx: -70, cpy: -215 },
    { x: -10, y: -120, cpx: 0, cpy: -170 },
    { x: -20, y: -40, cpx: 10, cpy: -80 },
    { x: -80, y: 0, cpx: -40, cpy: -5 },
    { x: -140, y: 20, cpx: -120, cpy: 30 },
    { x: -200, y: 80, cpx: -170, cpy: 60 },
    { x: -240, y: 40, cpx: -230, cpy: 80 },
    { x: -250, y: -60, cpx: -260, cpy: 0 },
  ];

  const southAmericaPoints: EarthSplinePoint[] = [
    { x: -140, y: 20 },
    { x: -110, y: 70, cpx: -130, cpy: 40 },
    { x: -70, y: 150, cpx: -90, cpy: 100 },
    { x: -80, y: 220, cpx: -40, cpy: 200 },
    { x: -120, y: 250, cpx: -100, cpy: 250 },
    { x: -150, y: 190, cpx: -150, cpy: 240 },
    { x: -170, y: 110, cpx: -170, cpy: 160 },
    { x: -160, y: 50, cpx: -180, cpy: 80 },
    { x: -140, y: 20, cpx: -160, cpy: 30 },
  ];

  const australiaPoints: EarthSplinePoint[] = [
    { x: 60, y: 170 },
    { x: 120, y: 160, cpx: 80, cpy: 150 },
    { x: 150, y: 200, cpx: 150, cpy: 170 },
    { x: 110, y: 240, cpx: 160, cpy: 240 },
    { x: 60, y: 230, cpx: 90, cpy: 240 },
    { x: 30, y: 200, cpx: 40, cpy: 220 },
    { x: 40, y: 180, cpx: 30, cpy: 190 },
    { x: 60, y: 170, cpx: 50, cpy: 170 },
  ];

  const greenlandPoints: EarthSplinePoint[] = [
    { x: -200, y: -120 },
    { x: -180, y: -180, cpx: -220, cpy: -160 },
    { x: -120, y: -210, cpx: -160, cpy: -220 },
    { x: -80, y: -170, cpx: -90, cpy: -210 },
    { x: -90, y: -120, cpx: -60, cpy: -140 },
    { x: -140, y: -80, cpx: -120, cpy: -90 },
    { x: -200, y: -120, cpx: -170, cpy: -80 },
  ];

  const earthContinents: EarthContinentConfig[] = [
    {
      center: { x: 0.66, y: 0.48 },
      scale: 0.48,
      aspect: 0.9,
      rotation: 0.08,
      fillStops: [
        { offset: 0, color: '#14532d' },
        { offset: 0.4, color: '#1f9d55' },
        { offset: 1, color: '#0f7654' },
      ],
      coastline: 'rgba(241, 245, 249, 0.75)',
      coastlineAlpha: 0.32,
      coastlineWidth: 18,
      points: eurasiaPoints,
      decorate: (localCtx, detailRand) => {
        localCtx.globalAlpha = 0.32;
        localCtx.fillStyle = 'rgba(253, 224, 71, 0.8)';
        localCtx.beginPath();
        localCtx.ellipse(-20, 70, 110, 55, -0.2, 0, Math.PI * 2);
        localCtx.fill();

        localCtx.beginPath();
        localCtx.ellipse(50, 45, 65, 38, 0.45, 0, Math.PI * 2);
        localCtx.fill();

        localCtx.globalAlpha = 0.26;
        const steppe = localCtx.createLinearGradient(-140, -40, 140, 50);
        steppe.addColorStop(0, 'rgba(101, 163, 13, 0.6)');
        steppe.addColorStop(1, 'rgba(13, 148, 136, 0.1)');
        localCtx.fillStyle = steppe;
        localCtx.fillRect(-230, -120, 430, 220);

        localCtx.globalAlpha = 0.28;
        localCtx.fillStyle = 'rgba(22, 101, 52, 0.75)';
        for (let i = 0; i < 120; i += 1) {
          const px = -150 + detailRand() * 320;
          const py = -60 + detailRand() * 220;
          const rx = 5 + detailRand() * 16;
          const ry = rx * (0.5 + detailRand() * 0.5);
          localCtx.beginPath();
          localCtx.ellipse(px, py, rx, ry, detailRand() * Math.PI, 0, Math.PI * 2);
          localCtx.fill();
        }

        localCtx.globalAlpha = 0.55;
        localCtx.strokeStyle = 'rgba(148, 163, 184, 0.75)';
        localCtx.lineWidth = 5;
        localCtx.lineJoin = 'round';
        localCtx.beginPath();
        localCtx.moveTo(-70, -20);
        localCtx.lineTo(10, -40);
        localCtx.lineTo(70, -15);
        localCtx.lineTo(120, -5);
        localCtx.stroke();

        localCtx.beginPath();
        localCtx.moveTo(30, 0);
        localCtx.lineTo(90, 20);
        localCtx.lineTo(140, 10);
        localCtx.stroke();

        localCtx.globalAlpha = 0.18;
        localCtx.fillStyle = 'rgba(34, 197, 94, 0.65)';
        localCtx.beginPath();
        localCtx.ellipse(-80, 160, 70, 50, 0.1, 0, Math.PI * 2);
        localCtx.fill();

        localCtx.globalAlpha = 1;
      },
    },
    {
      center: { x: 0.3, y: 0.42 },
      scale: 0.4,
      aspect: 1.02,
      rotation: -0.12,
      fillStops: [
        { offset: 0, color: '#14532d' },
        { offset: 0.5, color: '#15803d' },
        { offset: 1, color: '#166534' },
      ],
      coastline: 'rgba(241, 245, 249, 0.7)',
      coastlineAlpha: 0.35,
      coastlineWidth: 16,
      points: northAmericaPoints,
      decorate: (localCtx, detailRand) => {
        localCtx.globalAlpha = 0.3;
        localCtx.fillStyle = 'rgba(21, 128, 61, 0.85)';
        for (let i = 0; i < 90; i += 1) {
          const px = -200 + detailRand() * 200;
          const py = -80 + detailRand() * 140;
          const rx = 5 + detailRand() * 18;
          const ry = rx * (0.45 + detailRand() * 0.4);
          localCtx.beginPath();
          localCtx.ellipse(px, py, rx, ry, detailRand() * Math.PI, 0, Math.PI * 2);
          localCtx.fill();
        }

        localCtx.globalAlpha = 0.38;
        localCtx.fillStyle = 'rgba(250, 204, 21, 0.6)';
        localCtx.beginPath();
        localCtx.ellipse(-70, 30, 60, 30, -0.3, 0, Math.PI * 2);
        localCtx.fill();

        localCtx.globalAlpha = 0.22;
        const plains = localCtx.createLinearGradient(-160, -10, -20, 80);
        plains.addColorStop(0, 'rgba(74, 222, 128, 0.8)');
        plains.addColorStop(1, 'rgba(21, 128, 61, 0.1)');
        localCtx.fillStyle = plains;
        localCtx.fillRect(-210, -20, 220, 140);

        localCtx.globalAlpha = 0.5;
        localCtx.strokeStyle = 'rgba(148, 163, 184, 0.8)';
        localCtx.lineWidth = 5;
        localCtx.beginPath();
        localCtx.moveTo(-150, -40);
        localCtx.lineTo(-90, -20);
        localCtx.lineTo(-40, 10);
        localCtx.lineTo(-10, 30);
        localCtx.stroke();

        localCtx.globalAlpha = 1;
      },
    },
    {
      center: { x: 0.36, y: 0.66 },
      scale: 0.32,
      aspect: 1.05,
      rotation: -0.05,
      fillStops: [
        { offset: 0, color: '#14532d' },
        { offset: 0.45, color: '#1a9a4f' },
        { offset: 1, color: '#0f7a4b' },
      ],
      coastline: 'rgba(241, 245, 249, 0.7)',
      coastlineAlpha: 0.3,
      coastlineWidth: 12,
      points: southAmericaPoints,
      decorate: (localCtx, detailRand) => {
        localCtx.globalAlpha = 0.34;
        localCtx.fillStyle = 'rgba(4, 120, 87, 0.8)';
        localCtx.beginPath();
        localCtx.ellipse(-110, 120, 80, 70, -0.1, 0, Math.PI * 2);
        localCtx.fill();

        localCtx.globalAlpha = 0.45;
        localCtx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
        localCtx.lineWidth = 4;
        localCtx.beginPath();
        localCtx.moveTo(-150, 30);
        localCtx.lineTo(-160, 90);
        localCtx.lineTo(-150, 150);
        localCtx.lineTo(-130, 210);
        localCtx.stroke();

        localCtx.globalAlpha = 0.28;
        localCtx.fillStyle = 'rgba(34, 197, 94, 0.7)';
        for (let i = 0; i < 60; i += 1) {
          const px = -140 + detailRand() * 100;
          const py = 80 + detailRand() * 120;
          const rx = 5 + detailRand() * 14;
          const ry = rx * (0.5 + detailRand() * 0.4);
          localCtx.beginPath();
          localCtx.ellipse(px, py, rx, ry, detailRand() * Math.PI, 0, Math.PI * 2);
          localCtx.fill();
        }

        localCtx.globalAlpha = 1;
      },
    },
    {
      center: { x: 0.75, y: 0.7 },
      scale: 0.24,
      aspect: 0.88,
      rotation: 0.22,
      fillStops: [
        { offset: 0, color: '#166534' },
        { offset: 0.5, color: '#22c55e' },
        { offset: 1, color: '#854d0e' },
      ],
      coastline: 'rgba(241, 245, 249, 0.6)',
      coastlineAlpha: 0.32,
      coastlineWidth: 10,
      points: australiaPoints,
      decorate: (localCtx) => {
        localCtx.globalAlpha = 0.45;
        localCtx.fillStyle = 'rgba(234, 179, 8, 0.65)';
        localCtx.beginPath();
        localCtx.ellipse(60, 200, 70, 45, -0.15, 0, Math.PI * 2);
        localCtx.fill();

        localCtx.globalAlpha = 0.28;
        localCtx.fillStyle = 'rgba(34, 197, 94, 0.6)';
        localCtx.beginPath();
        localCtx.ellipse(30, 170, 50, 30, 0.25, 0, Math.PI * 2);
        localCtx.fill();

        localCtx.globalAlpha = 1;
      },
    },
    {
      center: { x: 0.34, y: 0.24 },
      scale: 0.18,
      aspect: 1.1,
      rotation: -0.18,
      fillStops: [
        { offset: 0, color: '#e2f1ff' },
        { offset: 0.7, color: '#bae6fd' },
        { offset: 1, color: '#93c5fd' },
      ],
      coastline: 'rgba(241, 245, 249, 0.9)',
      coastlineAlpha: 0.5,
      coastlineWidth: 9,
      points: greenlandPoints,
      decorate: (localCtx) => {
        localCtx.globalAlpha = 0.35;
        localCtx.fillStyle = 'rgba(148, 163, 184, 0.55)';
        localCtx.beginPath();
        localCtx.ellipse(-140, -140, 70, 40, -0.2, 0, Math.PI * 2);
        localCtx.fill();
        localCtx.globalAlpha = 1;
      },
    },
  ];

  earthContinents.forEach((continent) => drawEarthContinent(ctx, width, height, rand, continent));

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  const equatorialGlow = ctx.createLinearGradient(0, height * 0.45, 0, height * 0.55);
  equatorialGlow.addColorStop(0, 'rgba(255, 255, 255, 0)');
  equatorialGlow.addColorStop(0.5, 'rgba(255, 255, 255, 0.18)');
  equatorialGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = equatorialGlow;
  ctx.fillRect(0, height * 0.3, width, height * 0.4);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const specular = ctx.createRadialGradient(
    width * 0.7,
    height * 0.35,
    width * 0.05,
    width * 0.7,
    height * 0.35,
    width * 0.5,
  );
  specular.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  specular.addColorStop(0.6, 'rgba(255, 255, 255, 0.12)');
  specular.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = specular;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // Multi-layer realistic clouds
  ctx.save();
  for (let layer = 0; layer < 3; layer += 1) {
    ctx.globalAlpha = 0.22 + layer * 0.14;
    for (let i = 0; i < 160; i += 1) {
      const x = rand() * width;
      const y = rand() * height;
      const radiusX = width * (0.025 + rand() * 0.08);
      const radiusY = radiusX * (0.35 + rand() * 0.45);

      const cloud = ctx.createRadialGradient(x, y, radiusX * 0.1, x, y, radiusX);
      cloud.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      cloud.addColorStop(0.6, 'rgba(255, 255, 255, 0.7)');
      cloud.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = cloud;
      ctx.beginPath();
      ctx.ellipse(x, y, radiusX, radiusY, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.4;
  for (let band = 0; band < 5; band += 1) {
    const latitude = height * (0.25 + band * 0.15);
    const thickness = height * (0.05 + rand() * 0.02);
    const bandGradient = ctx.createLinearGradient(0, latitude - thickness, 0, latitude + thickness);
    bandGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    bandGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.65)');
    bandGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = bandGradient;
    ctx.beginPath();
    ctx.ellipse(width * 0.5, latitude, width * (0.48 + rand() * 0.08), thickness, rand() * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < 6; i += 1) {
    const centerX = width * (0.2 + rand() * 0.6);
    const centerY = height * (0.25 + rand() * 0.5);
    const maxRadius = width * (0.035 + rand() * 0.035);
    ctx.beginPath();
    for (let angle = 0; angle <= Math.PI * 3.5; angle += 0.25) {
      const radius = (angle / (Math.PI * 3.5)) * maxRadius;
      const px = centerX + Math.cos(angle) * radius;
      const py = centerY + Math.sin(angle) * radius * 0.7;
      if (angle === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = width * 0.004;
    ctx.stroke();
  }
  ctx.restore();

  // Polar ice caps
  const northCap = ctx.createRadialGradient(width / 2, 0, 0, width / 2, height * 0.15, width * 0.7);
  northCap.addColorStop(0, 'rgba(248, 250, 252, 0.95)');
  northCap.addColorStop(0.6, 'rgba(241, 245, 249, 0.7)');
  northCap.addColorStop(1, 'rgba(241, 245, 249, 0)');
  ctx.fillStyle = northCap;
  ctx.fillRect(0, 0, width, height * 0.25);

  const southCap = ctx.createRadialGradient(width / 2, height, 0, width / 2, height * 0.85, width * 0.7);
  southCap.addColorStop(0, 'rgba(248, 250, 252, 0.98)');
  southCap.addColorStop(0.6, 'rgba(241, 245, 249, 0.75)');
  southCap.addColorStop(1, 'rgba(241, 245, 249, 0)');
  ctx.fillStyle = southCap;
  ctx.fillRect(0, height * 0.75, width, height * 0.25);
};

const paintMars: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  // Rusty red gradient base
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.35));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.55));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Large dark volcanic regions (Tharsis, etc)
  scatterBlotches(ctx, width, height, 400, [15, 90], darkenHex(base, 0.7), 0.35, rand);
  
  // Lighter dusty regions
  scatterBlotches(ctx, width, height, 350, [20, 100], lightenHex(base, 0.25), 0.22, rand);

  // Impact craters
  ctx.save();
  for (let i = 0; i < 180; i += 1) {
    const r = width * (0.008 + rand() * 0.045);
    const x = rand() * width;
    const y = rand() * height;
    
    const crater = ctx.createRadialGradient(x, y, 0, x, y, r);
    crater.addColorStop(0, darkenHex(base, 0.75));
    crater.addColorStop(0.6, darkenHex(base, 0.5));
    crater.addColorStop(0.9, colorToHex(base));
    crater.addColorStop(1, lightenHex(base, 0.2));
    
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = crater;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Dust storm patterns
  ctx.save();
  ctx.globalAlpha = 0.45;
  for (let i = 0; i < 150; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const radiusX = width * (0.03 + rand() * 0.08);
    const radiusY = radiusX * (0.25 + rand() * 0.35);
    
    const storm = ctx.createRadialGradient(x, y, radiusX * 0.2, x, y, radiusX);
    storm.addColorStop(0, lightenHex(base, 0.4));
    storm.addColorStop(0.7, lightenHex(base, 0.2));
    storm.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = storm;
    ctx.beginPath();
    ctx.ellipse(x, y, radiusX * 2, radiusY, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Polar ice caps
  const northIce = ctx.createRadialGradient(width / 2, 0, 0, width / 2, height * 0.12, width * 0.5);
  northIce.addColorStop(0, 'rgba(255, 250, 250, 0.9)');
  northIce.addColorStop(0.7, 'rgba(255, 240, 240, 0.5)');
  northIce.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = northIce;
  ctx.fillRect(0, 0, width, height * 0.2);

  const southIce = ctx.createRadialGradient(width / 2, height, 0, width / 2, height * 0.88, width * 0.5);
  southIce.addColorStop(0, 'rgba(255, 250, 250, 0.85)');
  southIce.addColorStop(0.7, 'rgba(255, 240, 240, 0.45)');
  southIce.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = southIce;
  ctx.fillRect(0, height * 0.8, width, height * 0.2);
};

const paintJupiter: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  // Base gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.35));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.45));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Complex banding system
  const bandCount = 18;
  for (let i = 0; i < bandCount; i += 1) {
    const y = (i / bandCount) * height;
    const bandHeight = height * (0.035 + rand() * 0.055);
    
    const stripe = ctx.createLinearGradient(0, y, 0, y + bandHeight);
    const isDark = i % 2 === 0;
    const color1 = isDark ? darkenHex(base, 0.35) : lightenHex(base, 0.32);
    const color2 = isDark ? darkenHex(base, 0.25) : lightenHex(base, 0.15);
    
    stripe.addColorStop(0, color1);
    stripe.addColorStop(0.5, color2);
    stripe.addColorStop(1, color1);
    
    ctx.fillStyle = stripe;
    ctx.globalAlpha = 0.88;
    ctx.fillRect(0, y, width, bandHeight);
    
    // Band turbulence
    ctx.save();
    ctx.globalAlpha = 0.3;
    for (let j = 0; j < 30; j += 1) {
      const tx = rand() * width;
      const ty = y + rand() * bandHeight;
      const tSize = bandHeight * (0.3 + rand() * 0.7);
      
      const turbGrad = ctx.createRadialGradient(tx, ty, 0, tx, ty, tSize);
      turbGrad.addColorStop(0, lightenHex(base, 0.25));
      turbGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = turbGrad;
      ctx.fillRect(tx - tSize, ty - tSize / 2, tSize * 2, tSize);
    }
    ctx.restore();
  }

  // Great Red Spot - highly detailed
  const spotX = width * 0.65;
  const spotY = height * 0.55;
  const spotRadiusX = width * 0.16;
  const spotRadiusY = height * 0.095;
  
  ctx.save();
  ctx.globalAlpha = 1;
  
  // Outer swirl
  const outerSpot = ctx.createRadialGradient(spotX, spotY, 0, spotX, spotY, spotRadiusX);
  outerSpot.addColorStop(0, '#dc2626');
  outerSpot.addColorStop(0.3, '#ef4444');
  outerSpot.addColorStop(0.6, '#b91c1c');
  outerSpot.addColorStop(1, 'rgba(185, 28, 28, 0)');
  ctx.fillStyle = outerSpot;
  ctx.beginPath();
  ctx.ellipse(spotX, spotY, spotRadiusX, spotRadiusY, Math.PI / 12, 0, Math.PI * 2);
  ctx.fill();
  
  // Inner eye
  const innerSpot = ctx.createRadialGradient(
    spotX - spotRadiusX * 0.2,
    spotY,
    0,
    spotX,
    spotY,
    spotRadiusX * 0.5
  );
  innerSpot.addColorStop(0, '#991b1b');
  innerSpot.addColorStop(0.7, '#dc2626');
  innerSpot.addColorStop(1, 'rgba(220, 38, 38, 0)');
  ctx.fillStyle = innerSpot;
  ctx.beginPath();
  ctx.ellipse(spotX, spotY, spotRadiusX * 0.6, spotRadiusY * 0.6, Math.PI / 12, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();

  // Atmospheric disturbances throughout
  scatterBlotches(ctx, width, height, 1200, [3, 22], lightenHex(base, 0.25), 0.12, rand);
  scatterBlotches(ctx, width, height, 800, [4, 18], darkenHex(base, 0.3), 0.1, rand);
};

const paintSaturn: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  // Soft banded appearance
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.32));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.42));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Subtle atmospheric bands
  const bandCount = 20;
  for (let i = 0; i < bandCount; i += 1) {
    const y = (i / bandCount) * height;
    const bandHeight = height * (0.028 + rand() * 0.045);
    
    const stripe = ctx.createLinearGradient(0, y, 0, y + bandHeight);
    const mix = i % 2 === 0 ? lightenHex(base, 0.28) : darkenHex(base, 0.28);
    stripe.addColorStop(0, mix);
    stripe.addColorStop(0.5, lightenHex(base, 0.14));
    stripe.addColorStop(1, darkenHex(base, 0.35));
    
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = stripe;
    ctx.fillRect(0, y, width, bandHeight);
  }

  // Atmospheric wisps
  scatterBlotches(ctx, width, height, 900, [5, 25], lightenHex(base, 0.25), 0.08, rand);
  scatterBlotches(ctx, width, height, 700, [4, 20], darkenHex(base, 0.2), 0.07, rand);

  // North polar hexagon (faint)
  ctx.save();
  ctx.globalAlpha = 0.3;
  const hexGrad = ctx.createRadialGradient(width / 2, 0, 0, width / 2, height * 0.15, width * 0.4);
  hexGrad.addColorStop(0, '#fbbf24');
  hexGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
  ctx.fillStyle = hexGrad;
  ctx.fillRect(0, 0, width, height * 0.2);
  ctx.restore();
};

const paintIceGiant = (tone: THREE.Color): PlanetTexturePainter => (ctx, width, height, _base, rand) => {
  // Smooth icy gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(tone, 0.3));
  gradient.addColorStop(0.5, colorToHex(tone));
  gradient.addColorStop(1, darkenHex(tone, 0.4));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Faint banding
  for (let i = 0; i < 12; i++) {
    const y = (i / 12) * height;
    const bandHeight = height * (0.05 + rand() * 0.08);
    const bandGrad = ctx.createLinearGradient(0, y, 0, y + bandHeight);
    bandGrad.addColorStop(0, lightenHex(tone, 0.15));
    bandGrad.addColorStop(1, darkenHex(tone, 0.15));
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = bandGrad;
    ctx.fillRect(0, y, width, bandHeight);
  }

  // Atmospheric streaks
  ctx.save();
  ctx.globalAlpha = 0.32;
  for (let i = 0; i < 200; i += 1) {
    const y = rand() * height;
    const radius = width * (0.025 + rand() * 0.07);
    
    const streak = ctx.createLinearGradient(0, y, width, y + radius * 0.25);
    streak.addColorStop(0, lightenHex(tone, 0.5));
    streak.addColorStop(0.6, lightenHex(tone, 0.3));
    streak.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = streak;
    ctx.beginPath();
    ctx.ellipse(width / 2, y, width * 0.65, radius * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Methane haze
  scatterBlotches(ctx, width, height, 600, [8, 35], lightenHex(tone, 0.4), 0.15, rand);
};

const paintPluto: PlanetTexturePainter = (ctx, width, height, base, rand) => {
  // Icy base gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, lightenHex(base, 0.3));
  gradient.addColorStop(0.5, colorToHex(base));
  gradient.addColorStop(1, darkenHex(base, 0.5));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Dark patches (tholins)
  scatterBlotches(ctx, width, height, 600, [8, 60], darkenHex(base, 0.7), 0.28, rand);
  
  // Bright icy patches
  scatterBlotches(ctx, width, height, 500, [10, 70], lightenHex(base, 0.35), 0.22, rand);

  // Tombaugh Regio (heart-shaped bright region)
  ctx.save();
  ctx.globalAlpha = 0.7;
  const heartX = width * 0.55;
  const heartY = height * 0.45;
  const heartSize = width * 0.25;
  
  const heart = ctx.createRadialGradient(heartX, heartY, 0, heartX, heartY, heartSize);
  heart.addColorStop(0, '#fef3c7');
  heart.addColorStop(0.7, '#fde68a');
  heart.addColorStop(1, 'rgba(253, 230, 138, 0)');
  ctx.fillStyle = heart;
  
  // Left lobe
  ctx.beginPath();
  ctx.ellipse(heartX - heartSize * 0.3, heartY - heartSize * 0.1, heartSize * 0.5, heartSize * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Right lobe
  ctx.beginPath();
  ctx.ellipse(heartX + heartSize * 0.3, heartY - heartSize * 0.1, heartSize * 0.5, heartSize * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();

  // Cratered terrain
  ctx.save();
  for (let i = 0; i < 120; i++) {
    const r = width * (0.005 + rand() * 0.03);
    const x = rand() * width;
    const y = rand() * height;
    const crater = ctx.createRadialGradient(x, y, 0, x, y, r);
    crater.addColorStop(0, darkenHex(base, 0.8));
    crater.addColorStop(0.8, colorToHex(base));
    crater.addColorStop(1, lightenHex(base, 0.2));
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = crater;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
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

  // Multiple specular glints that wrap around the planet
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.32;
  const glintRadius = width * 0.45;
  const glintInner = width * 0.04;
  const glintCenters = [0.18, 0.48, 0.78, 1.08];
  glintCenters.forEach((frac, index) => {
    const hx = width * frac;
    const hy = height * (0.26 + (index % 2) * 0.14);
    wrapXPositions(width, hx, glintRadius, (wrappedX) => {
      const highlight = ctx.createRadialGradient(wrappedX, hy, glintInner, wrappedX, hy, glintRadius);
      highlight.addColorStop(0, lightenHex(base, 0.55));
      highlight.addColorStop(0.3, lightenHex(base, 0.35));
      highlight.addColorStop(0.7, lightenHex(base, 0.12));
      highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = highlight;
      ctx.fillRect(wrappedX - glintRadius, hy - glintRadius, glintRadius * 2, glintRadius * 2);
    });
  });

  // Soft azimuthal contrast bands for wrap-around depth
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.4;
  const bandCount = 8;
  const bandWidth = width / bandCount;
  for (let i = 0; i < bandCount; i += 1) {
    const centerX = (i + 0.5) * bandWidth;
    const extent = bandWidth * 0.75;
    wrapXPositions(width, centerX, extent, (wrappedX) => {
      const gradient = ctx.createLinearGradient(wrappedX - extent, 0, wrappedX + extent, 0);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0.16)');
      gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.22)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
      ctx.fillStyle = gradient;
      ctx.fillRect(wrappedX - extent, 0, extent * 2, height);
    });
  }

  // Polar falloff to reinforce spherical lighting without a hard terminator
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 1;
  const polar = ctx.createLinearGradient(0, 0, 0, height);
  polar.addColorStop(0, 'rgba(0, 0, 0, 0.16)');
  polar.addColorStop(0.45, 'rgba(0, 0, 0, 0)');
  polar.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
  polar.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
  ctx.fillStyle = polar;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
}

function createPlanetTexture(name: string, baseColor: number): THREE.Texture | null {
  const canvas = createCanvas(2048, 1024);
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
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createPlanetMaterial(name: string, baseColor: number): THREE.MeshStandardMaterial {
  const texture = createPlanetTexture(name, baseColor);
  const options: THREE.MeshStandardMaterialParameters = {
    color: baseColor,
    metalness: 0.15,
    roughness: 0.7,
  };

  if (texture) {
    options.map = texture;
  }

  const lower = name.trim().toLowerCase();
  if (lower === 'mercury') {
    options.roughness = 0.9;
    options.metalness = 0.25;
  } else if (lower === 'venus') {
    options.roughness = 0.85;
    options.metalness = 0.1;
    options.emissive = new THREE.Color(baseColor).multiplyScalar(0.1);
  } else if (lower === 'earth') {
    options.roughness = 0.6;
    options.metalness = 0.3;
    options.emissive = new THREE.Color(0x0a1929).multiplyScalar(0.2);
  } else if (lower === 'mars') {
    options.roughness = 0.75;
    options.metalness = 0.2;
  } else if (lower === 'jupiter' || lower === 'saturn') {
    options.roughness = 0.6;
    options.metalness = 0.15;
    options.emissive = new THREE.Color(baseColor).multiplyScalar(0.08);
  } else if (lower === 'uranus' || lower === 'neptune') {
    options.roughness = 0.5;
    options.metalness = 0.2;
    options.emissive = new THREE.Color(baseColor).multiplyScalar(0.12);
  } else if (lower === 'pluto') {
    options.roughness = 0.8;
    options.metalness = 0.15;
  }

  return new THREE.MeshStandardMaterial(options);
}

function createSaturnRings(radius: number): THREE.Mesh | null {
  const canvas = createCanvas(2048, 128);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gradient.addColorStop(0.08, 'rgba(255, 255, 255, 0.15)');
  gradient.addColorStop(0.2, 'rgba(250, 235, 215, 0.5)');
  gradient.addColorStop(0.35, 'rgba(244, 212, 166, 0.7)');
  gradient.addColorStop(0.5, 'rgba(205, 164, 115, 0.8)');
  gradient.addColorStop(0.65, 'rgba(244, 212, 166, 0.65)');
  gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.35)');
  gradient.addColorStop(0.93, 'rgba(255, 255, 255, 0.1)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Ring gaps (Cassini division, etc)
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = 'rgba(10, 10, 10, 0.7)';
  const gaps = [
    { pos: 0.35, width: 0.02 },
    { pos: 0.48, width: 0.015 },
    { pos: 0.62, width: 0.018 },
    { pos: 0.75, width: 0.012 },
  ];
  for (const gap of gaps) {
    const x = canvas.width * gap.pos;
    const w = canvas.width * gap.width;
    ctx.fillRect(x, 0, w, canvas.height);
  }
  ctx.restore();

  // Fine ring structure
  ctx.save();
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * canvas.width;
    const width = 1 + Math.random() * 3;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(x, 0, width, canvas.height);
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;

  const inner = radius * SIZE_MULTIPLIER * SCALE * 1.6;
  const outer = radius * SIZE_MULTIPLIER * SCALE * 2.9;
  const geometry = new THREE.RingGeometry(inner, outer, 256, 4);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    metalness: 0.25,
    roughness: 0.65,
    opacity: 0.96,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  mesh.rotation.z = THREE.MathUtils.degToRad(26.7);
  return mesh;
}

function createSmallBodyTexture(spec: SmallBodySpec, shape: 'comet' | 'asteroid'): THREE.Texture | null {
  const canvas = createCanvas(512, 512);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const seedKey = `${spec.id ?? spec.name ?? shape}`;
  const rand = createSeededRandom(hashString(seedKey));
  const base = new THREE.Color(spec.color);

  ctx.fillStyle = shape === 'comet' ? darkenHex(base, 0.6) : darkenHex(base, 0.4);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  scatterBlotches(
    ctx,
    canvas.width,
    canvas.height,
    shape === 'comet' ? 180 : 400,
    [shape === 'comet' ? 6 : 3, shape === 'comet' ? 35 : 22],
    lightenHex(base, shape === 'comet' ? 0.4 : 0.25),
    0.28,
    rand,
  );

  scatterBlotches(
    ctx,
    canvas.width,
    canvas.height,
    shape === 'comet' ? 150 : 300,
    [shape === 'comet' ? 8 : 4, shape === 'comet' ? 45 : 28],
    darkenHex(base, shape === 'comet' ? 0.7 : 0.6),
    0.32,
    rand,
  );

  if (shape === 'comet') {
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 25; i += 1) {
      const y = rand() * canvas.height;
      const length = canvas.width * (0.25 + rand() * 0.5);
      const gradient = ctx.createLinearGradient(0, y, length, y);
      gradient.addColorStop(0, 'rgba(240, 248, 255, 0.9)');
      gradient.addColorStop(0.7, 'rgba(226, 232, 240, 0.4)');
      gradient.addColorStop(1, 'rgba(226, 232, 240, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, y, length, 2 + rand() * 5);
    }
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
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
