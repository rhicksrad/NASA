/* eslint-disable no-console */
import type { NeoItem } from '../types/nasa';
import { Neo3D, type PlanetSampleProvider, type SmallBodySpec } from '../visuals/neo3d';
import {
  horizonsDailyVectors,
  horizonsVectors,
  jdFromDateUTC,
  isFiniteVec3,
} from '../api/neo3dData';
import { loadSBDBConic } from '../api/sbdb';
import { SbdbExplorer } from '../components/SbdbExplorer';
import { propagateConic, type ConicElements } from '../orbits';
import { type Keplerian } from '../utils/orbit';
import '../styles/sbdb.css';

const DEG2RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const DEFAULT_RANGE_DAYS = 120;
const MIN_RANGE_SPAN_DAYS = 1 / 24;
const SLIDER_STEP_DAYS = 1 / 24;
const MAX_PLANET_SAMPLES = 360;
const NEO_BATCH_SIZE = 50;

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

function buildSmallBodyEntries(neos: NeoItem[]): Array<{ neo: NeoItem; spec: SmallBodySpec }> {
  const bodies: Array<{ neo: NeoItem; spec: SmallBodySpec }> = [];
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

    bodies.push({ neo, spec: { name: neo.name, color, els, orbit } });
  }
  return bodies;
}

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function formatNeoSize(neo: NeoItem): string | null {
  const km = neo.estimated_diameter?.kilometers;
  if (!km) return null;
  const { estimated_diameter_min: min, estimated_diameter_max: max } = km;
  if (!(Number.isFinite(min) && Number.isFinite(max))) return null;
  const avgKm = (min + max) / 2;
  if (!Number.isFinite(avgKm) || avgKm <= 0) return null;
  if (avgKm >= 1) {
    return `${avgKm.toFixed(2)} km`;
  }
  const avgMeters = avgKm * 1000;
  if (avgMeters >= 1) {
    return `${avgMeters.toFixed(0)} m`;
  }
  return `${(avgMeters * 100).toFixed(0)} cm`;
}

function formatNextApproach(neo: NeoItem): string | null {
  const next = neo.next;
  if (!next) return null;
  const extras: string[] = [];
  if (next.distAu) extras.push(`dist ${next.distAu} AU`);
  if (next.vRelKms) extras.push(`${next.vRelKms} km/s`);
  const detail = extras.length ? ` (${extras.join(', ')})` : '';
  return `${next.date}${detail}`;
}

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

    const targetJd = jdFromDateUTC(date);
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
  const neoAllToggle = document.getElementById('neo3d-toggle-neos') as HTMLInputElement | null;
  const neoLoadMore = document.getElementById('neo3d-load-more') as HTMLButtonElement | null;
  const neoList = document.getElementById('neo3d-neo-list') as HTMLElement | null;
  const neoSummary = document.getElementById('neo3d-neo-summary') as HTMLElement | null;
  const sbdbHost = document.getElementById('sbdb-explorer-host') as HTMLDivElement | null;
  const sbdbLoaded = document.getElementById('sbdb-loaded') as HTMLDivElement | null;
  const sbdbLoadedEmpty = document.getElementById('sbdb-loaded-empty') as HTMLElement | null;

  if (sbdbHost) {
    sbdbHost.innerHTML = '';
    new SbdbExplorer(sbdbHost);
  }

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

  type EntrySource = 'neo' | 'sbdb';

  type NeoEntry = {
    spec: SmallBodySpec;
    enabled: boolean;
    checkbox: HTMLInputElement | null;
    element: HTMLDivElement;
    normalizedKeys: string[];
    source: EntrySource;
  };

  const neoEntries = new Map<string, NeoEntry>();
  const entryKeyIndex = new Map<string, string>();
  let allNeos: NeoItem[] = [];
  let nextNeoIndex = 0;
  let sbdbCounter = 0;
  type LoadedSbdbEntry = {
    spec: SmallBodySpec;
    chip: HTMLSpanElement | null;
    entryId: string;
    keys: Set<string>;
    primaryKey: string;
    label: string;
  };
  const sbdbEntries = new Map<string, LoadedSbdbEntry>();
  const sbdbAliasIndex = new Map<string, string>();

  function normalizeKey(value: string): string {
    return value.trim().toLowerCase();
  }

  function makeColorFor(label: string): number {
    if (/atlas/i.test(label)) return 0xf87171;
    let hash = 0;
    for (let i = 0; i < label.length; i += 1) {
      hash = ((hash << 5) - hash + label.charCodeAt(i)) | 0;
    }
    const hues = [0x22d3ee, 0x34d399, 0xf59e0b, 0x818cf8, 0x60a5fa, 0x10b981, 0xeab308];
    return hues[Math.abs(hash) % hues.length];
  }

  const clearEmptyState = () => {
    if (!neoList) return;
    const empty = neoList.querySelector('.neo3d-empty');
    empty?.remove();
  };

  const renderNeoEmptyState = () => {
    if (!neoList || neoEntries.size > 0) return;
    neoList.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'neo3d-empty';
    empty.setAttribute('role', 'listitem');
    empty.textContent = 'NEOs with orbital data will appear here when available.';
    neoList.appendChild(empty);
  };

  const getRemainingNeos = () => Math.max(0, allNeos.length - nextNeoIndex);

  const updateSbdbLoadedState = () => {
    if (sbdbLoadedEmpty) {
      sbdbLoadedEmpty.hidden = sbdbEntries.size > 0;
    }
    if (sbdbLoaded && sbdbEntries.size === 0) {
      sbdbLoaded.innerHTML = '';
    }
  };

  updateSbdbLoadedState();

  const updateLoadMoreState = () => {
    if (!neoLoadMore) return;
    const remaining = getRemainingNeos();
    if (!allNeos.length || remaining <= 0) {
      neoLoadMore.hidden = true;
      neoLoadMore.disabled = true;
      return;
    }
    const nextCount = Math.min(NEO_BATCH_SIZE, remaining);
    neoLoadMore.hidden = false;
    neoLoadMore.disabled = false;
    neoLoadMore.textContent = `Add ${nextCount} more`;
  };

  const registerEntryKeys = (id: string, keys: string[]) => {
    for (const key of keys) {
      if (key) {
        entryKeyIndex.set(key, id);
      }
    }
  };

  const unregisterEntryKeys = (id: string) => {
    for (const [key, value] of entryKeyIndex.entries()) {
      if (value === id) {
        entryKeyIndex.delete(key);
      }
    }
  };

  const insertEntryElement = (entry: NeoEntry, anchor?: Element | null) => {
    if (!neoList) return;
    if (anchor && anchor.parentElement === neoList) {
      neoList.insertBefore(entry.element, anchor);
    } else {
      if (entry.source === 'neo') {
        const sbdbAnchor = neoList.querySelector('[data-source="sbdb"]');
        if (sbdbAnchor) {
          neoList.insertBefore(entry.element, sbdbAnchor);
          return;
        }
      }
      neoList.appendChild(entry.element);
    }
  };

  const addEntry = (id: string, entry: NeoEntry, anchor?: Element | null) => {
    registerEntryKeys(id, entry.normalizedKeys);
    neoEntries.set(id, entry);
    clearEmptyState();
    insertEntryElement(entry, anchor);
  };

  const removeEntry = (id: string) => {
    const entry = neoEntries.get(id);
    if (!entry) return;
    if (entry.source === 'sbdb') {
      const sbdbEntry = sbdbEntries.get(id);
      if (sbdbEntry) {
        for (const aliasKey of sbdbEntry.keys) {
          sbdbAliasIndex.delete(aliasKey);
        }
        sbdbEntry.chip?.remove();
        sbdbEntry.chip = null;
        sbdbEntries.delete(id);
      }
      updateSbdbLoadedState();
    }
    unregisterEntryKeys(id);
    entry.element.remove();
    neoEntries.delete(id);
    if (neoEntries.size === 0) {
      renderNeoEmptyState();
    }
  };

  const removeEntriesBySource = (source: EntrySource) => {
    const ids = Array.from(neoEntries.entries())
      .filter(([, entry]) => entry.source === source)
      .map(([id]) => id);
    for (const id of ids) {
      removeEntry(id);
    }
  };

  const countEntries = () => {
    let neoCount = 0;
    let sbdbCount = 0;
    let enabledCount = 0;
    for (const entry of neoEntries.values()) {
      if (entry.source === 'neo') {
        neoCount += 1;
      } else {
        sbdbCount += 1;
      }
      if (entry.enabled) {
        enabledCount += 1;
      }
    }
    return { neoCount, sbdbCount, enabledCount, total: neoCount + sbdbCount };
  };

  const updateAllToggleState = () => {
    if (!neoAllToggle) return;
    const { total, enabledCount } = countEntries();
    if (total === 0) {
      neoAllToggle.checked = false;
      neoAllToggle.indeterminate = false;
      neoAllToggle.disabled = true;
      return;
    }
    neoAllToggle.disabled = false;
    neoAllToggle.checked = enabledCount === total;
    neoAllToggle.indeterminate = enabledCount > 0 && enabledCount < total;
  };

  const updateNeoSummary = () => {
    if (!neoSummary) return;
    const counts = countEntries();
    if (counts.total === 0) {
      if (!allNeos.length) {
        neoSummary.textContent = 'Awaiting NEO data…';
      } else if (nextNeoIndex >= allNeos.length) {
        neoSummary.textContent = 'No NEOs with orbital data available.';
      } else {
        neoSummary.textContent = 'Load more NEOs to display them.';
      }
      return;
    }
    let message: string;
    if (counts.enabledCount === 0) {
      message = 'All objects hidden.';
    } else if (counts.enabledCount === counts.total) {
      message = `Showing all ${counts.total} objects.`;
    } else {
      message = `Showing ${counts.enabledCount} of ${counts.total} objects.`;
    }
    const details: string[] = [];
    if (counts.neoCount > 0) {
      details.push(`${counts.neoCount} ${counts.neoCount === 1 ? 'NEO' : 'NEOs'}`);
    }
    if (counts.sbdbCount > 0) {
      details.push(`${counts.sbdbCount} SBDB ${counts.sbdbCount === 1 ? 'object' : 'objects'}`);
    }
    if (details.length) {
      message = `${message} (${details.join(' • ')})`;
    }
    const remaining = getRemainingNeos();
    if (remaining > 0) {
      const remainNoun = remaining === 1 ? 'NEO available' : 'NEOs available';
      message = `${message} ${remaining} more ${remainNoun}.`;
    }
    neoSummary.textContent = message;
  };

  const refreshNeoUi = () => {
    updateAllToggleState();
    updateNeoSummary();
    updateLoadMoreState();
  };

  const formatDiameterValue = (km: number | undefined | null): string | null => {
    if (!(typeof km === 'number' && Number.isFinite(km)) || km <= 0) return null;
    if (km >= 1) return `${km.toFixed(2)} km`;
    const meters = km * 1000;
    if (meters >= 1) return `${meters.toFixed(0)} m`;
    return `${(meters * 100).toFixed(0)} cm`;
  };

  function updateSmallBodies() {
    const bodies: SmallBodySpec[] = [];
    for (const entry of neoEntries.values()) {
      if (entry.enabled) {
        bodies.push(entry.spec);
      }
    }
    simulation.setSmallBodies(bodies);
  }

  interface ListEntryOptions {
    id: string;
    spec: SmallBodySpec;
    name: string;
    metaParts: string[];
    hazard?: string | null;
    defaultEnabled: boolean;
    normalizedKeys: string[];
    source: EntrySource;
  }

  const createListEntry = ({
    id,
    spec,
    name,
    metaParts,
    hazard,
    defaultEnabled,
    normalizedKeys,
    source,
  }: ListEntryOptions): NeoEntry => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = defaultEnabled;
    checkbox.id = `neo3d-entry-${id}`;
    checkbox.className = 'neo3d-neo-checkbox';

    const item = document.createElement('div');
    item.className = 'neo3d-neo-item';
    item.dataset.entryId = id;
    item.dataset.source = source;
    item.setAttribute('role', 'listitem');

    const label = document.createElement('label');

    const nameRow = document.createElement('span');
    nameRow.className = 'neo3d-neo-name';

    const colorDot = document.createElement('span');
    colorDot.className = 'neo3d-neo-color';
    colorDot.style.background = hexColor(spec.color ?? 0x22d3ee);

    nameRow.appendChild(checkbox);
    nameRow.appendChild(colorDot);
    const nameText = document.createElement('span');
    nameText.textContent = name;
    nameRow.appendChild(nameText);

    const meta = document.createElement('span');
    meta.className = 'neo3d-neo-meta';
    const filteredMeta = metaParts.filter((part) => part && part.trim().length > 0);
    meta.textContent = filteredMeta.length ? filteredMeta.join(' • ') : '—';

    label.appendChild(nameRow);
    label.appendChild(meta);

    if (hazard) {
      const hazardTag = document.createElement('span');
      hazardTag.className = 'neo3d-neo-hazard';
      hazardTag.textContent = hazard;
      label.appendChild(hazardTag);
    }

    item.appendChild(label);

    const entry: NeoEntry = {
      spec,
      enabled: defaultEnabled,
      checkbox,
      element: item,
      normalizedKeys,
      source,
    };

    checkbox.addEventListener('change', () => {
      entry.enabled = checkbox.checked;
      updateSmallBodies();
      refreshNeoUi();
    });

    return entry;
  };

  const loadNextNeos = (batchSize = NEO_BATCH_SIZE) => {
    if (!allNeos.length) {
      updateSmallBodies();
      refreshNeoUi();
      if (neoEntries.size === 0) {
        renderNeoEmptyState();
      }
      return;
    }

    const entriesToAdd: Array<{ neo: NeoItem; spec: SmallBodySpec }> = [];
    let added = 0;

    while (nextNeoIndex < allNeos.length && added < batchSize) {
      const remaining = batchSize - added;
      const sliceEnd = Math.min(allNeos.length, nextNeoIndex + remaining);
      const slice = allNeos.slice(nextNeoIndex, sliceEnd);
      nextNeoIndex = sliceEnd;
      const built = buildSmallBodyEntries(slice);
      if (built.length === 0) continue;
      entriesToAdd.push(...built);
      added += built.length;
    }

    if (entriesToAdd.length === 0) {
      if (neoEntries.size === 0) {
        renderNeoEmptyState();
      }
      updateSmallBodies();
      refreshNeoUi();
      return;
    }

    const defaultEnabled =
      neoAllToggle && !neoAllToggle.disabled && !neoAllToggle.indeterminate
        ? neoAllToggle.checked
        : true;

    const anchor = neoList?.querySelector('[data-source="sbdb"]') ?? null;

    for (const { neo, spec } of entriesToAdd) {
      const normalizedKeys = [neo.name, neo.id, neo.neo_reference_id, neo.designation]
        .map((value) => (typeof value === 'string' ? normalizeKey(value) : ''))
        .filter((key): key is string => Boolean(key && key !== 'null' && key !== 'undefined'));
      if (normalizedKeys.some((key) => entryKeyIndex.has(key))) {
        continue;
      }
      const metaParts = [`H ${neo.absolute_magnitude_h.toFixed(1)}`];
      const sizeLabel = formatNeoSize(neo);
      if (sizeLabel) metaParts.push(`~${sizeLabel}`);
      const nextApproach = formatNextApproach(neo);
      if (nextApproach) {
        metaParts.push(`Next: ${nextApproach}`);
      } else if (neo.next === null) {
        metaParts.push('Next: No future approaches on record.');
      }

      const entryId = `neo:${neo.id}`;
      const entry = createListEntry({
        id: entryId,
        spec,
        name: neo.name,
        metaParts,
        hazard: neo.is_potentially_hazardous_asteroid ? 'Potentially hazardous' : null,
        defaultEnabled,
        normalizedKeys,
        source: 'neo',
      });
      addEntry(entryId, entry, anchor);
    }

    updateSmallBodies();
    refreshNeoUi();
  };

  async function addSBDBObject(raw: string): Promise<void> {
    const query = raw.trim();
    if (!query) return;
    const key = normalizeKey(query);
    if (sbdbAliasIndex.has(key)) {
      const existingId = sbdbAliasIndex.get(key);
      const existing = existingId ? sbdbEntries.get(existingId) : undefined;
      const label = existing?.label ?? query;
      toastError(`Already added: ${label}`);
      return;
    }

    try {
      const { conic, label, row, aliases } = await loadSBDBConic(query);

      const aliasSet = new Set<string>();
      const pushAlias = (value: string | null | undefined) => {
        if (typeof value !== 'string') return;
        const normalized = normalizeKey(value);
        if (!normalized) return;
        aliasSet.add(normalized);
      };

      pushAlias(query);
      pushAlias(label);
      if (row?.id) pushAlias(row.id);
      if (row?.name) pushAlias(row.name);
      for (const alias of aliases) {
        pushAlias(alias);
      }

      const candidateKeys = Array.from(aliasSet);
      if (candidateKeys.length === 0) {
        candidateKeys.push(key);
      }

      for (const candidate of candidateKeys) {
        if (!candidate) continue;
        const existingId = entryKeyIndex.get(candidate);
        if (existingId) {
          const existing = neoEntries.get(existingId);
          const existingLabel = existing?.spec.label ?? existing?.spec.name ?? label;
          toastError(`${label} is already loaded as ${existingLabel}.`);
          return;
        }
        const existingSbdbId = sbdbAliasIndex.get(candidate);
        if (existingSbdbId) {
          const existing = sbdbEntries.get(existingSbdbId);
          const existingLabel = existing?.label ?? label;
          toastError(`${label} is already loaded as ${existingLabel}.`);
          return;
        }
      }

      const color = makeColorFor(label);
      const epochJD = typeof conic.epoch === 'number' && Number.isFinite(conic.epoch)
        ? conic.epoch
        : conic.tp;
      const meanAnomaly = typeof conic.ma === 'number' && Number.isFinite(conic.ma) ? conic.ma : 0;
      const conicForProp: ConicElements = {
        a: conic.a,
        e: conic.e,
        inc: conic.i,
        Omega: conic.Omega,
        omega: conic.omega,
        epochJD,
        M0: meanAnomaly,
        tp_jd: conic.tp,
        q: conic.q,
      };
      const spanDays = conic.e > 1 ? 3200 : undefined;
      const segments = conic.e > 1 ? 1600 : 720;

      const probe = propagateConic(conicForProp, jdFromDateUTC(simulation.getCurrentDate()));
      if (!isFiniteVec3(probe.posAU)) {
        throw new Error('SBDB propagation returned non-finite state');
      }

      const sample: NonNullable<SmallBodySpec['sample']> = (date) => {
        try {
          const state = propagateConic(conicForProp, jdFromDateUTC(date));
          return isFiniteVec3(state.posAU) ? state : null;
        } catch (error) {
          console.warn('[sbdb] propagate failed', error);
          return null;
        }
      };

      const keplerEls: Keplerian = {
        a: conic.a,
        e: conic.e,
        i: conic.i,
        Omega: conic.Omega,
        omega: conic.omega,
        M: meanAnomaly,
        epochJD,
      };

      const spec: SmallBodySpec = {
        name: label,
        label,
        color,
        els: keplerEls,
        sample,
        orbit: { color, segments, spanDays },
      };

      const normalizedKeys = candidateKeys.length > 0 ? candidateKeys : [key];
      const defaultEnabled =
        neoAllToggle && !neoAllToggle.disabled && !neoAllToggle.indeterminate
          ? neoAllToggle.checked
          : true;

      const metaParts: string[] = [];
      if (row?.H != null && Number.isFinite(row.H)) {
        metaParts.push(`H ${row.H.toFixed(2)}`);
      }
      const sizeLabel = formatDiameterValue(row?.estDiameterKm ?? null);
      if (sizeLabel) {
        metaParts.push(`~${sizeLabel}`);
      }
      metaParts.push(`e ${conic.e.toFixed(4)}`);
      metaParts.push(`q ${conic.q.toFixed(3)} au`);
      if (row?.type) {
        metaParts.push(row.type);
      }

      const entryId = `sbdb:${sbdbCounter += 1}`;
      const primaryKey =
        (row?.id && aliasSet.has(normalizeKey(row.id)) ? normalizeKey(row.id) : null) ??
        (aliasSet.has(normalizeKey(label)) ? normalizeKey(label) : null) ??
        normalizedKeys[0] ?? key;

      const entryInfo: LoadedSbdbEntry = {
        spec,
        chip: null,
        entryId,
        keys: new Set(normalizedKeys),
        primaryKey,
        label,
      };

      const entry = createListEntry({
        id: entryId,
        spec,
        name: label,
        metaParts,
        hazard: null,
        defaultEnabled,
        normalizedKeys: Array.from(entryInfo.keys),
        source: 'sbdb',
      });

      sbdbEntries.set(entryId, entryInfo);
      for (const aliasKey of entryInfo.keys) {
        sbdbAliasIndex.set(aliasKey, entryId);
      }

      addEntry(entryId, entry);

      updateSmallBodies();
      refreshNeoUi();

      let chip: HTMLSpanElement | null = null;
      if (sbdbLoaded) {
        chip = document.createElement('span');
        chip.className = 'sbdb-chip';
        chip.dataset.key = entryInfo.primaryKey;
        const swatch = `#${color.toString(16).padStart(6, '0')}`;
        chip.innerHTML = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${swatch}"></span><span>${label}</span><button aria-label="Remove">×</button>`;
        const removeBtn = chip.querySelector('button');
        removeBtn?.addEventListener('click', () => {
          removeEntry(entryId);
          updateSmallBodies();
          refreshNeoUi();
        });
        sbdbLoaded.appendChild(chip);
      }

      entryInfo.chip = chip;
      toast(`Added SBDB: ${label}`);
      updateSbdbLoadedState();
    } catch (error) {
      console.error('[sbdb] add failed', error);
      const message = error instanceof Error && error.message ? error.message : 'SBDB add failed';
      toastError(message);
    }
  }

  if (neoLoadMore) {
    neoLoadMore.addEventListener('click', () => {
      loadNextNeos(NEO_BATCH_SIZE);
    });
  }

  window.addEventListener('neo3d:add-sbdb', (event) => {
    const detail = (event as CustomEvent<string | null | undefined>).detail;
    if (typeof detail === 'string' && detail.trim().length > 0) {
      void addSBDBObject(detail);
    }
  });

  if (neoAllToggle) {
    neoAllToggle.disabled = true;
    neoAllToggle.indeterminate = false;
    neoAllToggle.addEventListener('change', () => {
      const enabled = neoAllToggle.checked;
      for (const entry of neoEntries.values()) {
        entry.enabled = enabled;
        if (entry.checkbox) {
          entry.checkbox.checked = enabled;
        }
      }
      updateSmallBodies();
      refreshNeoUi();
    });
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
    allNeos = [...neos];
    nextNeoIndex = 0;
    removeEntriesBySource('neo');
    updateSmallBodies();
    refreshNeoUi();
    if (!allNeos.length) {
      if (neoEntries.size === 0) {
        renderNeoEmptyState();
      }
      return;
    }
    loadNextNeos(NEO_BATCH_SIZE);
  };

  applyNeos(getSelectedNeos());

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
