/** Procedural canvas textures for planets, Saturn's rings and small bodies. No image downloads. */
import * as THREE from 'three';
import { SCALE, SIZE_MULTIPLIER, type SmallBodySpec } from './types';

const WHITE = new THREE.Color(0xffffff);
const BLACK = new THREE.Color(0x000000);

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

const paintEarth: PlanetTexturePainter = (ctx, width, height, _base, rand) => {
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

export function createPlanetMaterial(name: string, baseColor: number): THREE.MeshStandardMaterial {
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

export function createSaturnRings(radius: number): THREE.Mesh | null {
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

export function createSmallBodyTexture(spec: SmallBodySpec, shape: 'comet' | 'asteroid'): THREE.Texture | null {
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
