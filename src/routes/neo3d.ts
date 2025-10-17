/* eslint-disable no-console */
import type { NeoItem } from '../types/nasa';
import { Neo3D, type PlanetSampleProvider, type SmallBodySpec } from '../visuals/neo3d';
import { horizonsDailyVectors, horizonsVectors, loadAtlasSBDB, type VectorSample } from '../api/neo3dData';
import { HttpError } from '../api/nasaClient';
import { jdFromDate, type Keplerian } from '../utils/orbit';
import { propagateConic } from '../orbits';
import { jdFromDateUTC } from '../time';

const DEG2RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const MIN_TIME = Date.UTC(1900, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);

interface PlanetConfig {
  spk: number;
  name: string;
  color: number;
  radius?: number;
}

const PLANET_CONFIG: PlanetConfig[] = [
  { spk: 199, name: 'Mercury', color: 0x9ca3af, radius: 0.022 },
  { spk: 299, name: 'Venus', color: 0xf59e0b, radius: 0.028 },
  { spk: 399, name: 'Earth', color: 0x3b82f6, radius: 0.03 },
  { spk: 499, name: 'Mars', color: 0xef4444, radius: 0.025 },
  { spk: 599, name: 'Jupiter', color: 0xfbbf24, radius: 0.045 },
  { spk: 699, name: 'Saturn', color: 0xfcd34d, radius: 0.04 },
  { spk: 799, name: 'Uranus', color: 0x60a5fa, radius: 0.035 },
  { spk: 899, name: 'Neptune', color: 0x818cf8, radius: 0.034 },
  { spk: 999, name: 'Pluto', color: 0xe5e7eb, radius: 0.018 },
];

function clampUtc(date: Date): Date {
  const ms = Math.min(Math.max(date.getTime(), MIN_TIME), MAX_TIME);
  return new Date(ms);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number.NaN;
}

function toKeplerian(neo: NeoItem): Keplerian | null {
  const orbital = neo.orbital_data;
  if (!orbital) return null;
  const a = toNumber(orbital.semi_major_axis);
  const e = toNumber(orbital.eccentricity);
  const i = toNumber(orbital.inclination);
  const Omega = toNumber(orbital.ascending_node_longitude);
  const omega = toNumber(orbital.perihelion_argument);
  const M = toNumber(orbital.mean_anomaly);
  const epochJD = toNumber(orbital.epoch_osculation);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(e) ||
    !Number.isFinite(i) ||
    !Number.isFinite(Omega) ||
    !Number.isFinite(omega) ||
    !Number.isFinite(M) ||
    !Number.isFinite(epochJD)
  ) {
    return null;
  }
  return {
    a,
    e,
    i: i * DEG2RAD,
    Omega: Omega * DEG2RAD,
    omega: omega * DEG2RAD,
    M: M * DEG2RAD,
    epochJD,
  };
}

const isFinite3 = (v: readonly number[]): boolean => v.length === 3 && v.every(Number.isFinite);

const describeError = (error: unknown, fallback: string): string => {
  if (error instanceof HttpError) {
    return `${fallback} (HTTP ${error.status} for ${error.url})`;
  }
  if (error instanceof Error && error.message) {
    return `${fallback}: ${error.message}`;
  }
  return fallback;
};

let toastHost: HTMLDivElement | null = null;

function ensureToastHost(): HTMLDivElement {
  if (toastHost && document.body.contains(toastHost)) {
    return toastHost;
  }
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.bottom = '16px';
  host.style.right = '16px';
  host.style.maxWidth = '320px';
  host.style.zIndex = '9999';
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.gap = '8px';
  toastHost = host;
  document.body.appendChild(host);
  return host;
}

function showToast(message: string, background: string, color = '#fff'): void {
  const host = ensureToastHost();
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.background = background;
  toast.style.color = color;
  toast.style.padding = '10px 14px';
  toast.style.borderRadius = '6px';
  toast.style.boxShadow = '0 8px 16px rgba(0,0,0,0.35)';
  toast.style.fontSize = '14px';
  toast.style.lineHeight = '1.35';
  host.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
    if (toastHost && !toastHost.childElementCount) {
      toastHost.remove();
      toastHost = null;
    }
  }, 6000);
}

function toastError(message: string): void {
  showToast(message, 'rgba(17, 24, 39, 0.92)');
}

function toast(message: string): void {
  showToast(message, 'rgba(59, 130, 246, 0.92)');
}

function buildBodies(neos: NeoItem[]): SmallBodySpec[] {
  const bodies: SmallBodySpec[] = [];
  for (const neo of neos) {
    const els = toKeplerian(neo);
    if (!els) continue;
    if (!(els.a > 0) || els.e < 0 || els.e >= 1 || !Number.isFinite(els.epochJD)) {
      console.warn('[neo3d] bad elements skipped', { name: neo.name, els });
      continue;
    }
    const color = neo.is_potentially_hazardous_asteroid ? 0xef4444 : 0x22d3ee;
    const segments = els.e < 1 ? 720 : 1600;
    const orbit: SmallBodySpec['orbit'] = {
      color,
      segments,
      spanDays: els.e < 1 ? undefined : 2600,
    };
    bodies.push({ name: neo.name, color, els, orbit });
    if (bodies.length >= 80) break;
  }
  return bodies;
}

class PlanetEphemeris {
  private samples: VectorSample[] = [];
  private pending = new Map<string, Promise<void>>();
  private lastKnown: [number, number, number] | null = null;
  private approximateRadius = 0;

  constructor(private readonly spk: number) {}

  async prime(date: Date): Promise<void> {
    const day = startOfUtcDay(date);
    await Promise.all([this.ensure(day), this.ensure(addDays(day, 1))]);
  }

  getPosition(date: Date): [number, number, number] | null {
    const day = startOfUtcDay(date);
    this.ensure(day).catch(() => undefined);
    this.ensure(addDays(day, 1)).catch(() => undefined);

    if (!this.samples.length && this.lastKnown) {
      return [...this.lastKnown];
    }

    const targetJd = jdFromDate(date);
    if (!this.samples.length) {
      return null;
    }

    let previous = this.samples[0];
    let next = this.samples[this.samples.length - 1];
    for (const sample of this.samples) {
      if (sample.jd <= targetJd) {
        previous = sample;
      }
      if (sample.jd >= targetJd) {
        next = sample;
        break;
      }
    }

    const dt = next.jd - previous.jd;
    let pos: [number, number, number];
    if (dt <= 0) {
      pos = [...previous.posAU];
    } else {
      const t = (targetJd - previous.jd) / dt;
      pos = [
        previous.posAU[0] + (next.posAU[0] - previous.posAU[0]) * t,
        previous.posAU[1] + (next.posAU[1] - previous.posAU[1]) * t,
        previous.posAU[2] + (next.posAU[2] - previous.posAU[2]) * t,
      ];
    }
    if (!isFinite3(pos)) {
      return null;
    }
    this.lastKnown = [...pos];
    this.approximateRadius = Math.hypot(pos[0], pos[1], pos[2]);
    return pos;
  }

  radiusHint(): number | undefined {
    if (this.approximateRadius) {
      return this.approximateRadius;
    }
    if (this.lastKnown) {
      const [x, y, z] = this.lastKnown;
      return Math.hypot(x, y, z);
    }
    return undefined;
  }

  private ensure(date: Date): Promise<void> {
    const key = date.toISOString().slice(0, 10);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = horizonsDailyVectors(this.spk, date)
      .then(samples => {
        for (const sample of samples) {
          if (!isFinite3(sample.posAU)) {
            continue;
          }
          const existingIndex = this.samples.findIndex(item => Math.abs(item.jd - sample.jd) < 1e-6);
          if (existingIndex >= 0) {
            this.samples[existingIndex] = sample;
          } else {
            this.samples.push(sample);
          }
          if (!this.lastKnown) {
            this.lastKnown = [...sample.posAU];
            this.approximateRadius = Math.hypot(sample.posAU[0], sample.posAU[1], sample.posAU[2]);
          }
        }
        this.samples.sort((a, b) => a.jd - b.jd);
        if (this.samples.length > 10) {
          this.samples.splice(0, this.samples.length - 10);
        }
      })
      .catch(error => {
        console.error(`[neo3d] Horizons vector fetch failed for ${this.spk}`, error);
        throw error;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }
}

class PlanetManager {
  private nodes: Array<{ config: PlanetConfig; ephemeris: PlanetEphemeris }>;

  constructor(configs: PlanetConfig[]) {
    this.nodes = configs.map(config => ({ config, ephemeris: new PlanetEphemeris(config.spk) }));
  }

  async prime(date: Date): Promise<void> {
    const survivors: Array<{ config: PlanetConfig; ephemeris: PlanetEphemeris }> = [];
    for (const node of this.nodes) {
      try {
        await node.ephemeris.prime(date);
        survivors.push(node);
      } catch (error) {
        const message = describeError(error, `${node.config.name} ephemeris unavailable`);
        toastError(message);
      }
    }
    this.nodes = survivors;
  }

  providers(): PlanetSampleProvider[] {
    return this.nodes.map(({ config, ephemeris }) => {
      const orbitRadius = ephemeris.radiusHint();
      const finiteRadius = typeof orbitRadius === 'number' && Number.isFinite(orbitRadius) ? orbitRadius : undefined;
      return {
        name: config.name,
        color: config.color,
        radius: config.radius,
        orbitRadius: finiteRadius,
        getPosition: (date: Date) => ephemeris.getPosition(date),
      };
    });
  }
}

export interface Neo3DController {
  setNeos(neos: NeoItem[]): void;
}

export async function initNeo3D(
  getSelectedNeos: () => NeoItem[],
  host?: HTMLElement | null,
): Promise<Neo3DController | null> {
  const container = host ?? document.getElementById('neo3d-host');
  if (!(container instanceof HTMLElement)) {
    return null;
  }

  const now = clampUtc(new Date());
  const dateEl = document.getElementById('neo3d-date');
  const simulation = new Neo3D({
    host: container,
    dateLabel: dateEl,
    initialDate: now,
    minDate: new Date(MIN_TIME),
    maxDate: new Date(MAX_TIME),
  });

  const planetManager = new PlanetManager(PLANET_CONFIG);
  await planetManager.prime(now);
  const planetProviders = planetManager.providers();
  simulation.setPlanets(planetProviders);
  simulation.setTimeScale(86_400);
  simulation.setPaused(false);
  simulation.start();

  const apply = (neos: NeoItem[]) => {
    const bodies = buildBodies(neos);
    simulation.clearSmallBodies();
    if (bodies.length) {
      simulation.addSmallBodies(bodies);
    }
  };

  apply(getSelectedNeos());

  const validationTime = new Date('2025-11-19T04:00:02Z');
  try {
    const [mercury, venus] = await Promise.all([
      horizonsVectors(199, validationTime),
      horizonsVectors(299, validationTime),
    ]);
    console.assert(
      mercury.posAU.every(Number.isFinite),
      'Mercury Horizons VECTORS invalid',
      mercury,
    );
    console.assert(
      venus.posAU.every(Number.isFinite),
      'Venus Horizons VECTORS invalid',
      venus,
    );
  } catch (error) {
    console.assert(false, 'Horizons validation failed', error);
  }

  const earthProvider = planetProviders.find(p => p.name.toLowerCase() === 'earth');
  const earthPos = earthProvider?.getPosition(now);
  if (earthPos && isFinite3(earthPos)) {
    const distance = Math.hypot(earthPos[0], earthPos[1], earthPos[2]);
    console.assert(Math.abs(distance - 1) <= 0.02, 'Earth barycenter distance sanity', distance);
  }

  const speedSel = document.getElementById('neo3d-speed') as HTMLSelectElement | null;
  if (speedSel) {
    speedSel.value = '86400';
    speedSel.addEventListener('change', () => {
      const value = Number(speedSel.value);
      if (value === 0) {
        simulation.setPaused(true);
      } else {
        simulation.setPaused(false);
        simulation.setTimeScale(value);
      }
    });
  }

  const add3iBtn = document.getElementById('neo3d-load-3i') as HTMLButtonElement | null;
  if (add3iBtn) {
    const defaultLabel = add3iBtn.textContent ?? 'Add 3I/ATLAS';
    let loaded = false;
    add3iBtn.addEventListener('click', async () => {
      if (loaded) return;
      add3iBtn.disabled = true;
      add3iBtn.textContent = 'Loading…';
      try {
        const el = await loadAtlasSBDB();
        const nowDate = simulation.getCurrentDate();
        const initialState = propagateConic(el, jdFromDateUTC(nowDate));
        if (!isFinite3(initialState.posAU)) {
          throw new Error('3I/ATLAS propagation invalid');
        }
        let sampleWarned = false;
        const sample: NonNullable<SmallBodySpec['sample']> = date => {
          try {
            const state = propagateConic(el, jdFromDateUTC(date));
            return isFinite3(state.posAU) ? state : null;
          } catch (err) {
            if (!sampleWarned) {
              console.warn('[neo3d] 3I/ATLAS sample failed', err);
              sampleWarned = true;
            }
            return null;
          }
        };
        simulation.addSmallBodies([
          {
            name: '3I/ATLAS',
            color: 0xf87171,
            sample,
            orbit: { color: 0xf87171, segments: 1600, spanDays: 3200 },
            label: '3I/ATLAS',
          },
        ]);
        console.assert(initialState.posAU.every(Number.isFinite), '3I/ATLAS propagated position finite', el);
        add3iBtn.textContent = '3I/ATLAS (SBDB)';
        console.info('[neo3d] ATLAS loaded from sbdb?sstr=3I');
        toast('3I/ATLAS loaded from SBDB 3I');
        loaded = true;
      } catch (error) {
        console.error('[neo3d] ATLAS load failed', error);
        toastError(describeError(error, '3I/ATLAS failed to load'));
        add3iBtn.disabled = false;
        add3iBtn.textContent = '3I unavailable';
        setTimeout(() => {
          if (!loaded) add3iBtn.textContent = defaultLabel;
        }, 3_000);
      }
    });
  }

  return {
    setNeos: apply,
  };
}
