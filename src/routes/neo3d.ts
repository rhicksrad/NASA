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
  type Elements,
} from '../api/neo3dData';
import { type Keplerian } from '../utils/orbit';

const DEG2RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const GAUSSIAN_K = 0.01720209895;
const DEFAULT_RANGE_DAYS = 120;
const MIN_RANGE_SPAN_DAYS = 1 / 24;
const SLIDER_STEP_DAYS = 1 / 24;

const SPEED_PRESETS: Array<{ seconds: number; label: string }> = [
  { seconds: 3600, label: '1 hr/s' },
  { seconds: 21_600, label: '6 hr/s' },
  { seconds: 43_200, label: '12 hr/s' },
  { seconds: 86_400, label: '1 day/s' },
  { seconds: 604_800, label: '1 wk/s' },
  { seconds: 2_592_000, label: '1 mo/s' },
];

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatDateLabel(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function toDateTimeLocalValue(date: Date): string {
  const pad = (v: number, len = 2) => v.toString().padStart(len, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDateTimeLocal(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function differenceInDays(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / DAY_MS;
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

function elementsToKeplerian(elements: Elements): Keplerian | null {
  const { a, e, i, Omega, omega, epochJD, M0, tp_jd, q } = elements;

  if (!(Number.isFinite(e) && e > 0)) return null;
  if (![i, Omega, omega].every(Number.isFinite)) return null;

  let semiMajor = typeof a === 'number' && Number.isFinite(a) ? a : undefined;
  if (semiMajor == null && typeof q === 'number' && Number.isFinite(q)) {
    if (e < 1) {
      semiMajor = q / (1 - e);
    } else if (e > 1) {
      semiMajor = -q / (e - 1);
    }
  }
  if (!(typeof semiMajor === 'number' && Number.isFinite(semiMajor) && semiMajor !== 0)) {
    return null;
  }

  const epoch = typeof epochJD === 'number' && Number.isFinite(epochJD)
    ? epochJD
    : typeof tp_jd === 'number' && Number.isFinite(tp_jd)
      ? tp_jd
      : null;
  if (epoch == null) return null;

  let mean = typeof M0 === 'number' && Number.isFinite(M0) ? M0 : null;
  if (mean == null && typeof tp_jd === 'number' && Number.isFinite(tp_jd)) {
    const aAbs = Math.abs(semiMajor);
    if (aAbs <= 0) return null;
    const n = Math.sqrt((GAUSSIAN_K * GAUSSIAN_K) / (aAbs * aAbs * aAbs));
    mean = n * (epoch - tp_jd);
    if (e < 1) {
      const twoPi = Math.PI * 2;
      mean = ((mean % twoPi) + twoPi) % twoPi;
    }
  }
  if (mean == null || !Number.isFinite(mean)) return null;

  return {
    a: semiMajor,
    e,
    i,
    Omega,
    omega,
    M: mean,
    epochJD: epoch,
  };
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
  let rangeStart = new Date(now.getTime() - (DEFAULT_RANGE_DAYS / 2) * DAY_MS);
  let rangeEnd = new Date(now.getTime() + (DEFAULT_RANGE_DAYS / 2) * DAY_MS);

  const timeLabel =
    (document.getElementById('neo3d-date') as HTMLElement | null) ??
    (document.getElementById('neo3d-time-label') as HTMLElement | null);

  let onDateChangeHandler: ((date: Date) => void) | null = null;

  const simulation = new Neo3D({
    host: container,
    dateLabel: timeLabel,
    initialDate: now,
    minDate: rangeStart,
    maxDate: rangeEnd,
    onDateChange: (date) => {
      onDateChangeHandler?.(date);
    },
  });

  const planetManager = new PlanetManager(PLANET_CONFIG);
  await planetManager.prime(now);
  simulation.setPlanets(planetManager.providers());

  simulation.setTimeScale(SPEED_PRESETS[SPEED_PRESETS.length - 1].seconds);
  simulation.setPaused(true);
  simulation.start();

  const playBtn = document.getElementById('neo3d-play') as HTMLButtonElement | null;
  const pauseBtn = document.getElementById('neo3d-pause') as HTMLButtonElement | null;
  const speedSlider = document.getElementById('neo3d-speed') as HTMLInputElement | null;
  const speedLabel = document.getElementById('neo3d-speed-label') as HTMLElement | null;
  const timeSlider = document.getElementById('neo3d-time') as HTMLInputElement | null;
  const rangeStartInput = document.getElementById('neo3d-range-start') as HTMLInputElement | null;
  const rangeEndInput = document.getElementById('neo3d-range-end') as HTMLInputElement | null;
  const neosToggle = document.getElementById('neo3d-toggle-neos') as HTMLInputElement | null;
  const atlasToggleBtn = document.getElementById('neo3d-toggle-atlas') as HTMLButtonElement | null;

  let sliderBaseMs = rangeStart.getTime();
  let sliderSpanDays = Math.max(MIN_RANGE_SPAN_DAYS, differenceInDays(rangeStart, rangeEnd));
  let playingRange = false;
  let scrubbing = false;

  const updateTimeLabel = (date: Date) => {
    if (timeLabel) {
      timeLabel.textContent = formatDateLabel(date);
    }
  };

  const updateSliderBounds = () => {
    if (!timeSlider) return;
    timeSlider.min = '0';
    timeSlider.max = sliderSpanDays.toString();
    timeSlider.step = SLIDER_STEP_DAYS.toString();
  };

  const updateSliderFromDate = (date: Date) => {
    if (!timeSlider) return;
    const offsetDays = (date.getTime() - sliderBaseMs) / DAY_MS;
    const clampedOffset = clamp(offsetDays, 0, sliderSpanDays);
    if (!scrubbing) {
      timeSlider.value = clampedOffset.toString();
    }
  };

  const updatePlayControls = () => {
    const paused = simulation.isPaused();
    const disabledPlay = !paused || rangeEnd.getTime() <= rangeStart.getTime();
    if (playBtn) playBtn.disabled = disabledPlay;
    if (pauseBtn) pauseBtn.disabled = paused;
  };

  const applyRange = (start: Date, end: Date) => {
    if (end.getTime() <= start.getTime()) {
      toastError('Range end must be after start');
      if (rangeStartInput) rangeStartInput.value = toDateTimeLocalValue(rangeStart);
      if (rangeEndInput) rangeEndInput.value = toDateTimeLocalValue(rangeEnd);
      return;
    }
    if (differenceInDays(start, end) < MIN_RANGE_SPAN_DAYS) {
      toastError('Date range must span at least one hour');
      if (rangeStartInput) rangeStartInput.value = toDateTimeLocalValue(rangeStart);
      if (rangeEndInput) rangeEndInput.value = toDateTimeLocalValue(rangeEnd);
      return;
    }

    rangeStart = start;
    rangeEnd = end;
    sliderBaseMs = rangeStart.getTime();
    sliderSpanDays = differenceInDays(rangeStart, rangeEnd);

    simulation.setBounds(rangeStart, rangeEnd);
    updateSliderBounds();

    simulation.setPaused(true);
    playingRange = false;

    const current = simulation.getCurrentDate();
    const clampedMs = clamp(current.getTime(), sliderBaseMs, rangeEnd.getTime());
    const clampedDate = new Date(clampedMs);
    simulation.setDate(clampedDate);
    updateSliderFromDate(clampedDate);
    updateTimeLabel(clampedDate);
    updatePlayControls();

    if (rangeStartInput) rangeStartInput.value = toDateTimeLocalValue(rangeStart);
    if (rangeEndInput) rangeEndInput.value = toDateTimeLocalValue(rangeEnd);
  };

  if (rangeStartInput) {
    rangeStartInput.value = toDateTimeLocalValue(rangeStart);
    rangeStartInput.addEventListener('change', () => {
      const parsed = parseDateTimeLocal(rangeStartInput.value);
      if (!parsed) {
        toastError('Invalid start date');
        rangeStartInput.value = toDateTimeLocalValue(rangeStart);
        return;
      }
      applyRange(parsed, rangeEnd);
    });
  }

  if (rangeEndInput) {
    rangeEndInput.value = toDateTimeLocalValue(rangeEnd);
    rangeEndInput.addEventListener('change', () => {
      const parsed = parseDateTimeLocal(rangeEndInput.value);
      if (!parsed) {
        toastError('Invalid end date');
        rangeEndInput.value = toDateTimeLocalValue(rangeEnd);
        return;
      }
      applyRange(rangeStart, parsed);
    });
  }

  if (timeSlider) {
    timeSlider.step = SLIDER_STEP_DAYS.toString();
    const stopScrubbing = () => {
      scrubbing = false;
    };
    timeSlider.addEventListener('pointerdown', () => {
      scrubbing = true;
      simulation.setPaused(true);
      playingRange = false;
      updatePlayControls();
    });
    timeSlider.addEventListener('pointerup', stopScrubbing);
    timeSlider.addEventListener('pointercancel', stopScrubbing);
    window.addEventListener('pointerup', stopScrubbing);
    timeSlider.addEventListener('input', () => {
      const offset = Number(timeSlider.value);
      if (!Number.isFinite(offset)) return;
      const next = new Date(sliderBaseMs + offset * DAY_MS);
      simulation.setDate(next);
      updateTimeLabel(next);
      simulation.setPaused(true);
      playingRange = false;
      updatePlayControls();
    });
    timeSlider.addEventListener('change', stopScrubbing);
  }

  if (speedSlider) {
    speedSlider.min = '0';
    speedSlider.max = String(SPEED_PRESETS.length - 1);
    speedSlider.step = '1';
    const updateSpeed = () => {
      const index = clamp(Math.round(Number(speedSlider.value)), 0, SPEED_PRESETS.length - 1);
      const preset = SPEED_PRESETS[index];
      speedSlider.value = String(index);
      simulation.setTimeScale(preset.seconds);
      if (speedLabel) speedLabel.textContent = preset.label;
    };
    speedSlider.addEventListener('input', updateSpeed);
    updateSpeed();
  }

  const extras = new Map<string, { spec: SmallBodySpec; enabled: boolean }>();
  let selectedNeos: SmallBodySpec[] = [];
  let neosEnabled = neosToggle?.checked ?? true;

  const updateSmallBodies = () => {
    const bodies: SmallBodySpec[] = [];
    if (neosEnabled) {
      bodies.push(...selectedNeos);
    }
    for (const extra of extras.values()) {
      if (extra.enabled) {
        bodies.push(extra.spec);
      }
    }
    simulation.setSmallBodies(bodies);
  };

  const updateAtlasToggleState = () => {
    if (!atlasToggleBtn) return;
    const atlasEntry = extras.get('atlas');
    if (!atlasEntry) {
      atlasToggleBtn.disabled = true;
      atlasToggleBtn.textContent = 'Loading 3I/ATLAS…';
      atlasToggleBtn.setAttribute('aria-pressed', 'false');
      return;
    }
    atlasToggleBtn.disabled = false;
    atlasToggleBtn.textContent = atlasEntry.enabled ? 'Hide 3I/ATLAS' : 'Show 3I/ATLAS';
    atlasToggleBtn.setAttribute('aria-pressed', atlasEntry.enabled ? 'true' : 'false');
  };

  if (atlasToggleBtn) {
    atlasToggleBtn.disabled = true;
    atlasToggleBtn.textContent = 'Loading 3I/ATLAS…';
    atlasToggleBtn.setAttribute('aria-pressed', 'false');
    atlasToggleBtn.addEventListener('click', () => {
      const atlasEntry = extras.get('atlas');
      if (!atlasEntry) return;
      atlasEntry.enabled = !atlasEntry.enabled;
      updateAtlasToggleState();
      updateSmallBodies();
    });
  }

  if (neosToggle) {
    neosEnabled = neosToggle.checked;
    neosToggle.addEventListener('change', () => {
      neosEnabled = neosToggle.checked;
      updateSmallBodies();
    });
  } else {
    neosEnabled = true;
  }

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      simulation.setDate(rangeStart);
      simulation.setPaused(false);
      playingRange = true;
      updateSliderFromDate(rangeStart);
      updateTimeLabel(rangeStart);
      updatePlayControls();
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      simulation.setPaused(true);
      playingRange = false;
      updatePlayControls();
    });
  }

  onDateChangeHandler = (date) => {
    updateTimeLabel(date);
    if (!scrubbing) {
      updateSliderFromDate(date);
    }
    if (playingRange && date.getTime() >= rangeEnd.getTime() - 1) {
      simulation.setDate(rangeEnd);
      simulation.setPaused(true);
      playingRange = false;
      updateSliderFromDate(rangeEnd);
      updateTimeLabel(rangeEnd);
      updatePlayControls();
    }
  };

  updateSliderBounds();
  updateSliderFromDate(simulation.getCurrentDate());
  updateTimeLabel(simulation.getCurrentDate());
  updatePlayControls();

  const applyNeos = (neos: NeoItem[]) => {
    selectedNeos = buildSmallBodies(neos);
    updateSmallBodies();
  };

  applyNeos(getSelectedNeos());

  const loadAtlas = async () => {
    try {
      const elements = await loadAtlasSBDB();
      const keplerEls = elementsToKeplerian(elements);
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
        label: 'C/2025 N1 (ATLAS)',
        color: 0xf87171,
        sample,
        orbit: { color: 0xf87171, segments: 1600, spanDays: 3200 },
      };

      if (keplerEls) {
        atlasSpec.els = keplerEls;
      } else {
        console.warn('[neo3d] 3I/ATLAS Keplerian conversion failed; using sample propagation only');
      }

      const existing = extras.get('atlas');
      if (existing) {
        existing.spec = atlasSpec;
      } else {
        extras.set('atlas', { spec: atlasSpec, enabled: true });
      }
      updateAtlasToggleState();
      updateSmallBodies();
      console.info('[neo3d] ATLAS loaded from sbdb?sstr=3I');
      toast('3I/ATLAS loaded from SBDB 3I');
    } catch (error) {
      console.error('[neo3d] ATLAS load failed', error);
      toastError('3I/ATLAS failed to load');
      if (atlasToggleBtn) {
        atlasToggleBtn.disabled = true;
        atlasToggleBtn.textContent = '3I/ATLAS unavailable';
        atlasToggleBtn.setAttribute('aria-pressed', 'false');
      }
    }
  };

  void loadAtlas();

  const iso = '2025-11-19T04:00:02Z';
  void Promise.all([
    horizonsVectors(199, iso),
    horizonsVectors(299, iso),
  ]).then(([mercury, venus]) => {
    console.assert(mercury.posAU.every(Number.isFinite), 'Mercury Horizons VECTORS invalid', mercury);
    console.assert(venus.posAU.every(Number.isFinite), 'Venus Horizons VECTORS invalid', venus);
  });

  return {
    setNeos(neos: NeoItem[]) {
      applyNeos(neos);
    },
  };
}
