import { Neo3D, type Body } from '../visuals/neo3d';
import type { NeoItem } from '../types/nasa';

const DAY_MS = 86400000;
const SAFE_COLORS = [0x10b981, 0x6366f1, 0x0ea5e9, 0xf59e0b, 0x14b8a6, 0x8b5cf6];
const HAZARD_COLOR = 0xef4444;

function hasOrbitalData(n: NeoItem): n is NeoItem & { orbital_data: NonNullable<NeoItem['orbital_data']> } {
  return Boolean(n.orbital_data);
}

export function elsFromNeo(n: NeoItem) {
  if (!hasOrbitalData(n)) {
    throw new Error('NEO missing orbital data');
  }
  const o = n.orbital_data;
  const a = Number(o.semi_major_axis);
  const e = Number(o.eccentricity);
  const i = Number(o.inclination);
  const Omega = Number(o.ascending_node_longitude);
  const omega = Number(o.perihelion_argument);
  const M = Number(o.mean_anomaly);
  const epochJD = Number(o.epoch_osculation);
  const values = [a, e, i, Omega, omega, M, epochJD];
  if (values.some(v => Number.isNaN(v))) {
    throw new Error('Invalid orbital element');
  }
  return { a, e, i, Omega, omega, M, epochJD };
}

export function bodiesFromNeos(neos: NeoItem[]): Body[] {
  const out: Body[] = [];
  let colorIndex = 0;
  for (const neo of neos) {
    if (!neo.orbital_data) continue;
    try {
      const els = elsFromNeo(neo);
      const color = neo.is_potentially_hazardous_asteroid
        ? HAZARD_COLOR
        : SAFE_COLORS[colorIndex++ % SAFE_COLORS.length];
      out.push({
        id: neo.id,
        name: neo.name,
        els,
        color,
      });
      if (out.length >= 50) break;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Skipping NEO with invalid elements', neo.name, err);
    }
  }
  return out;
}

export interface Neo3DController {
  sim: Neo3D;
  setNeos: (neos: NeoItem[]) => void;
}

function formatDateUTC(date: Date): string {
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

export function initNeo3D(getSelectedNeos: () => NeoItem[]): Neo3DController | null {
  const host = document.getElementById('neo3d-host') as HTMLDivElement | null;
  if (!host) return null;

  const speedSel = document.getElementById('neo3d-speed') as HTMLSelectElement | null;
  const timeSlider = document.getElementById('neo3d-time') as HTMLInputElement | null;
  const timeLabel = document.getElementById('neo3d-time-label') as HTMLSpanElement | null;

  const anchorMs = Date.now();
  let selectedBodies = bodiesFromNeos(getSelectedNeos());

  const sim = new Neo3D({ host, getSelected: () => selectedBodies });
  sim.setBodies(selectedBodies);
  sim.start();

  if (speedSel) {
    const applySpeed = () => {
      const mult = Number(speedSel.value);
      if (!Number.isFinite(mult) || mult < 0) return;
      if (mult === 0) {
        sim.setPaused(true);
      } else {
        sim.setPaused(false);
        sim.setTimeScale(mult);
      }
    };
    applySpeed();
    speedSel.addEventListener('change', applySpeed);
  }

  const updateLabel = (date: Date) => {
    if (timeLabel) {
      timeLabel.textContent = formatDateUTC(date);
    }
  };

  let scrubbing = false;
  if (timeSlider) {
    const applySlider = () => {
      const days = Number(timeSlider.value);
      if (!Number.isFinite(days)) return;
      const target = new Date(anchorMs + days * DAY_MS);
      sim.setSimTime(target);
      updateLabel(target);
    };

    timeSlider.addEventListener('input', () => {
      scrubbing = true;
      applySlider();
    });
    timeSlider.addEventListener('change', () => {
      scrubbing = false;
      applySlider();
    });
    timeSlider.addEventListener('pointerdown', () => {
      scrubbing = true;
    });
    timeSlider.addEventListener('pointerup', () => {
      scrubbing = false;
    });
    timeSlider.addEventListener('keydown', () => {
      scrubbing = true;
    });
    timeSlider.addEventListener('keyup', () => {
      scrubbing = false;
    });
  }

  sim.onTimeUpdate(date => {
    updateLabel(date);
    if (timeSlider && !scrubbing) {
      const offsetDays = (date.getTime() - anchorMs) / DAY_MS;
      const min = Number(timeSlider.min);
      const max = Number(timeSlider.max);
      if (Number.isFinite(min) && offsetDays < min) {
        timeSlider.value = String(min);
      } else if (Number.isFinite(max) && offsetDays > max) {
        timeSlider.value = String(max);
      } else {
        timeSlider.value = offsetDays.toFixed(2);
      }
    }
  });

  updateLabel(sim.getSimDate());

  return {
    sim,
    setNeos(neos: NeoItem[]) {
      selectedBodies = bodiesFromNeos(neos);
      sim.setBodies(selectedBodies);
    },
  };
}
