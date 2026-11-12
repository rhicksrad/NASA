/** Planet positions for the NEO 3D scene, sampled daily from JPL Horizons and interpolated. */
import { horizonsDailyVectors } from '../../api/horizons';
import { jdFromDate } from '../../lib/julian';
import type { PlanetSampleProvider } from './scene/Neo3D';

const MAX_PLANET_SAMPLES = 360;

export interface PlanetConfig {
  spk: number;
  name: string;
  color: number;
  radius?: number;
  diameterKm?: number;
  absMag?: number;
  kindHint?: string;
}

export const PLANET_CONFIG: PlanetConfig[] = [
  { spk: 199, name: 'Mercury', color: 0x9ca3af, radius: 0.022, diameterKm: 4879 },
  { spk: 299, name: 'Venus', color: 0xf59e0b, radius: 0.028, diameterKm: 12104 },
  { spk: 399, name: 'Earth', color: 0x3b82f6, radius: 0.03, diameterKm: 12756 },
  { spk: 499, name: 'Mars', color: 0xef4444, radius: 0.025, diameterKm: 6792 },
  { spk: 599, name: 'Jupiter', color: 0xfbbf24, radius: 0.045, diameterKm: 139820 },
  { spk: 699, name: 'Saturn', color: 0xfcd34d, radius: 0.04, diameterKm: 116460 },
  { spk: 799, name: 'Uranus', color: 0x60a5fa, radius: 0.035, diameterKm: 50724 },
  { spk: 899, name: 'Neptune', color: 0x818cf8, radius: 0.034, diameterKm: 49244 },
  { spk: 999, name: 'Pluto', color: 0xe5e7eb, radius: 0.018, diameterKm: 2376 },
];

const isFinite3 = (v: readonly number[]): boolean => v.length === 3 && v.every(Number.isFinite);

type CachedSample = { jd: number; posAU: [number, number, number] };

class PlanetEphemeris {
  private samples: CachedSample[] = [];
  private pending = new Map<string, Promise<void>>();
  private fetched = new Set<string>();
  private radius: number | null = null;
  private lastRequestedJd: number | null = null;

  constructor(private readonly spk: number) {}

  async prime(date: Date): Promise<void> {
    await this.ensureDay(startOfDayIso(date));
  }

  getPosition(date: Date): [number, number, number] | null {
    const startIso = startOfDayIso(date);
    this.ensureDay(startIso).catch(() => undefined);
    this.ensureDay(addDaysIso(startIso, 1)).catch(() => undefined);

    if (this.samples.length < 2) return null;

    const targetJd = jdFromDate(date);
    this.lastRequestedJd = targetJd;
    this.trimSamples(targetJd);
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
          if (!isFinite3(sample.posAU)) continue;
          const entry: CachedSample = { jd: sample.jd, posAU: [...sample.posAU] };
          const index = this.samples.findIndex((s) => Math.abs(s.jd - entry.jd) < 1e-6);
          if (index >= 0) {
            this.samples[index] = entry;
          } else {
            this.samples.push(entry);
          }
        }
        this.samples.sort((a, b) => a.jd - b.jd);
        this.trimSamples(this.lastRequestedJd);
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

  private trimSamples(aroundJd: number | null): void {
    if (this.samples.length <= MAX_PLANET_SAMPLES) return;
    if (aroundJd == null || !Number.isFinite(aroundJd)) {
      this.samples.splice(0, this.samples.length - MAX_PLANET_SAMPLES);
      return;
    }

    while (this.samples.length > MAX_PLANET_SAMPLES) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      const distFirst = Math.abs(first.jd - aroundJd);
      const distLast = Math.abs(last.jd - aroundJd);
      if (distFirst > distLast) {
        this.samples.shift();
      } else {
        this.samples.pop();
      }
    }
  }
}

export class PlanetManager {
  private nodes: Array<{ config: PlanetConfig; ephemeris: PlanetEphemeris }>;

  constructor(
    configs: PlanetConfig[],
    /** Called once per planet whose ephemeris could not be loaded. */
    private readonly onUnavailable: (planetName: string) => void = () => undefined,
  ) {
    this.nodes = configs.map((config) => ({ config, ephemeris: new PlanetEphemeris(config.spk) }));
  }

  async prime(date: Date): Promise<void> {
    await Promise.all(
      this.nodes.map(async (node) => {
        try {
          await node.ephemeris.prime(date);
        } catch {
          // The scene still renders; this planet simply stays hidden until data arrives.
          this.onUnavailable(node.config.name);
        }
      }),
    );
  }

  providers(): PlanetSampleProvider[] {
    return this.nodes.map(({ config, ephemeris }) => ({
      name: config.name,
      color: config.color,
      radius: config.radius,
      orbitRadius: ephemeris.orbitRadius(),
      diameterKm: config.diameterKm,
      absMag: config.absMag,
      kindHint: config.kindHint,
      getPosition: (date: Date) => ephemeris.getPosition(date),
    }));
  }
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
