/* eslint-disable no-console */
import type { NeoItem } from '../types/nasa';
import { Neo3D, type PlanetSampleProvider, type SmallBodySpec } from '../visuals/neo3d';
import {
  horizonsDailyVectors,
  horizonsVectors,
  jdFromDateUTC,
  loadAtlasSBDB,
  propagateConic,
  isFiniteVec3,
} from '../api/neo3dData';
import { type Keplerian } from '../utils/orbit';

const DEG2RAD = Math.PI / 180;
const DAY_MS = 86_400_000;

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

const isFinite3 = (v: readonly number[]): boolean => v.length === 3 && v.every(Number.isFinite);

function parseNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

function buildSmallBodies(neos: NeoItem[]): SmallBodySpec[] {
  const bodies: SmallBodySpec[] = [];
  for (const neo of neos) {
    const orbital = neo.orbital_data;
    if (!orbital) continue;

    const a = parseNumber(orbital.semi_major_axis);
    const e = parseNumber(orbital.eccentricity);
    const i = parseNumber(orbital.inclination);
    const Omega = parseNumber(orbital.ascending_node_longitude);
    const omega = parseNumber(orbital.perihelion_argument);
    const M = parseNumber(orbital.mean_anomaly);
    const epochJD = parseNumber(orbital.epoch_osculation);

    if (
      !Number.isFinite(a) ||
      !Number.isFinite(e) ||
      !Number.isFinite(i) ||
      !Number.isFinite(Omega) ||
      !Number.isFinite(omega) ||
      !Number.isFinite(M) ||
      !Number.isFinite(epochJD)
    ) {
      continue;
    }

    const els: Keplerian = {
      a,
      e,
      i: i * DEG2RAD,
      Omega: Omega * DEG2RAD,
      omega: omega * DEG2RAD,
      M: M * DEG2RAD,
      epochJD,
    };

    const color = neo.is_potentially_hazardous_asteroid ? 0xef4444 : 0x22d3ee;
    const segments = e < 1 ? 720 : 1600;
    const orbit: NonNullable<SmallBodySpec['orbit']> = {
      color,
      segments,
      spanDays: e < 1 ? undefined : 3200,
    };

    bodies.push({ name: neo.name, color, els, orbit });
  }
  return bodies;
}

type CachedSample = { jd: number; posAU: [number, number, number] };

class PlanetEphemeris {
  private samples: CachedSample[] = [];
  private pending = new Map<string, Promise<void>>();
  private fetched = new Set<string>();
  private radius: number | null = null;

  constructor(private readonly spk: number) {}

  async prime(date: Date): Promise<void> {
    await this.ensureDay(startOfDayIso(date));
  }

  getPosition(date: Date): [number, number, number] | null {
    const startIso = startOfDayIso(date);
    this.ensureDay(startIso).catch(() => undefined);
    this.ensureDay(addDaysIso(startIso, 1)).catch(() => undefined);

    if (this.samples.length < 2) return null;

    const targetJd = jdFromDateUTC(date);
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

    const span = next.jd - previous.jd;
    let pos: [number, number, number];
    if (span <= 0) {
      pos = [...previous.posAU];
    } else {
      const t = (targetJd - previous.jd) / span;
      pos = [
        previous.posAU[0] + (next.posAU[0] - previous.posAU[0]) * t,
        previous.posAU[1] + (next.posAU[1] - previous.posAU[1]) * t,
        previous.posAU[2] + (next.posAU[2] - previous.posAU[2]) * t,
      ];
    }

    if (!isFinite3(pos)) return null;
    this.radius = Math.hypot(pos[0], pos[1], pos[2]);
    return pos;
  }

  orbitRadius(): number | undefined {
    if (this.radius != null && Number.isFinite(this.radius)) return this.radius;
    if (this.samples.length) {
      const sample = this.samples[0];
      return Math.hypot(sample.posAU[0], sample.posAU[1], sample.posAU[2]);
    }
    return undefined;
  }

  private ensureDay(startIso: string): Promise<void> {
    if (this.fetched.has(startIso)) return Promise.resolve();
    const existing = this.pending.get(startIso);
    if (existing) return existing;

    const promise = horizonsDailyVectors(this.spk, startIso, 2)
      .then((samples) => {
        for (const sample of samples) {
          if (!isFiniteVec3(sample.posAU)) continue;
          const entry: CachedSample = { jd: sample.jd, posAU: [...sample.posAU] };
          const index = this.samples.findIndex((s) => Math.abs(s.jd - entry.jd) < 1e-6);
          if (index >= 0) {
            this.samples[index] = entry;
          } else {
            this.samples.push(entry);
          }
        }
        this.samples.sort((a, b) => a.jd - b.jd);
        if (this.samples.length > 10) {
          this.samples.splice(0, this.samples.length - 10);
        }
        this.fetched.add(startIso);
      })
      .catch((error) => {
        console.error(`[neo3d] Horizons vectors failed for ${this.spk}`, error);
        throw error;
      })
      .finally(() => {
        this.pending.delete(startIso);
      });

    this.pending.set(startIso, promise);
    return promise;
  }
}

class PlanetManager {
  private nodes: Array<{ config: PlanetConfig; ephemeris: PlanetEphemeris }>;

  constructor(configs: PlanetConfig[]) {
    this.nodes = configs.map((config) => ({ config, ephemeris: new PlanetEphemeris(config.spk) }));
  }

  async prime(date: Date): Promise<void> {
    await Promise.all(
      this.nodes.map(async (node) => {
        try {
          await node.ephemeris.prime(date);
        } catch (error) {
          toastError(`${node.config.name} Horizons unavailable`);
          throw error;
        }
      }),
    ).catch(() => undefined);
  }

  providers(): PlanetSampleProvider[] {
    return this.nodes.map(({ config, ephemeris }) => ({
      name: config.name,
      color: config.color,
      radius: config.radius,
      orbitRadius: ephemeris.orbitRadius(),
      getPosition: (date: Date) => ephemeris.getPosition(date),
    }));
  }
}

let toastHost: HTMLDivElement | null = null;

function ensureToastHost(): HTMLDivElement {
  if (toastHost && document.body.contains(toastHost)) return toastHost;
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.bottom = '16px';
  host.style.right = '16px';
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.gap = '8px';
  host.style.zIndex = '9999';
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
  toast.style.boxShadow = '0 8px 16px rgba(0,0,0,0.4)';
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

function toast(message: string): void {
  showToast(message, 'rgba(37, 99, 235, 0.9)');
}

function toastError(message: string): void {
  showToast(message, 'rgba(17, 24, 39, 0.92)');
}

function startOfDayIso(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return `${day.toISOString().slice(0, 19)}Z`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.toISOString().slice(0, 19)}Z`;
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

  const now = new Date();
  const dateLabel =
    (document.getElementById('neo3d-date') as HTMLElement | null) ??
    (document.getElementById('neo3d-time-label') as HTMLElement | null);

  const simulation = new Neo3D({
    host: container,
    dateLabel,
    initialDate: now,
  });

  const planetManager = new PlanetManager(PLANET_CONFIG);
  await planetManager.prime(now);
  simulation.setPlanets(planetManager.providers());

  simulation.setTimeScale(86_400);
  simulation.setPaused(false);
  simulation.start();

  const extras: SmallBodySpec[] = [];
  const applyNeos = (neos: NeoItem[]) => {
    const bodies = buildSmallBodies(neos);
    simulation.setSmallBodies([...bodies, ...extras]);
  };

  applyNeos(getSelectedNeos());

  const speedSel = document.getElementById('neo3d-speed') as HTMLSelectElement | null;
  if (speedSel) {
    if ([...speedSel.options].some((opt) => opt.value === '86400')) {
      speedSel.value = '86400';
    }
    speedSel.addEventListener('change', () => {
      const value = Number(speedSel.value);
      if (!Number.isFinite(value)) return;
      if (value === 0) {
        simulation.setPaused(true);
      } else {
        simulation.setPaused(false);
        simulation.setTimeScale(value);
      }
    });
  }

  const timeSlider = document.getElementById('neo3d-time') as HTMLInputElement | null;
  if (timeSlider) {
    const baseMs = now.getTime();
    timeSlider.addEventListener('input', () => {
      const offset = Number(timeSlider.value);
      if (!Number.isFinite(offset)) return;
      simulation.setDate(new Date(baseMs + offset * DAY_MS));
    });
  }

  const iso = '2025-11-19T04:00:02Z';
  void Promise.all([
    horizonsVectors(199, iso),
    horizonsVectors(299, iso),
  ]).then(([mercury, venus]) => {
    console.assert(mercury.posAU.every(Number.isFinite), 'Mercury Horizons VECTORS invalid', mercury);
    console.assert(venus.posAU.every(Number.isFinite), 'Venus Horizons VECTORS invalid', venus);
  });

  const add3iBtn = document.getElementById('neo3d-load-3i') as HTMLButtonElement | null;
  if (add3iBtn) {
    const defaultLabel = add3iBtn.textContent ?? 'Add 3I/ATLAS';
    let loaded = false;
    add3iBtn.addEventListener('click', async () => {
      if (loaded) return;
      add3iBtn.disabled = true;
      add3iBtn.textContent = 'Loading…';
      try {
        const elements = await loadAtlasSBDB();
        const initial = propagateConic(elements, jdFromDateUTC(simulation.getCurrentDate()));
        if (!isFiniteVec3(initial.posAU)) {
          throw new Error('3I/ATLAS propagation invalid');
        }
        const sample: NonNullable<SmallBodySpec['sample']> = (date) => {
          try {
            const state = propagateConic(elements, jdFromDateUTC(date));
            return isFiniteVec3(state.posAU) ? state : null;
          } catch (error) {
            console.warn('[neo3d] 3I/ATLAS propagation failed', error);
            return null;
          }
        };

        const atlasSpec: SmallBodySpec = {
          name: '3I/ATLAS',
          color: 0xf87171,
          sample,
          orbit: { color: 0xf87171, segments: 1600, spanDays: 3200 },
        };

        extras.push(atlasSpec);
        applyNeos(getSelectedNeos());
        console.info('[neo3d] ATLAS loaded from sbdb?sstr=3I');
        toast('3I/ATLAS loaded from SBDB 3I');
        add3iBtn.textContent = '3I/ATLAS';
        loaded = true;
      } catch (error) {
        console.error('[neo3d] ATLAS load failed', error);
        toastError('3I/ATLAS failed to load');
        add3iBtn.textContent = defaultLabel;
      } finally {
        if (!loaded) add3iBtn.disabled = false;
      }
    });
  }

  return {
    setNeos(neos: NeoItem[]) {
      applyNeos(neos);
    },
  };
}
