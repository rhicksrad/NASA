import type { NeoItem } from '../types/nasa';
import type { SbdbOrbit } from '../types/sbdb';
import { fromSbdb, type SbdbOrbitRecord, earthElementsApprox } from '../utils/orbit';
import { Neo3D, type Body } from '../visuals/neo3d';
import { loadInterstellar3I } from '../neo3d';

const DEG2RAD = Math.PI / 180;

const ROUGH_PLANETS: Array<{ name: string; color: number; els: ReturnType<typeof earthElementsApprox> }> = [
  { name: 'Earth', color: 0x64b5f6, els: earthElementsApprox() },
];

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number(value);
  }
  return Number.NaN;
}

function orbitFromNeo(neo: NeoItem): Body | null {
  const orbital = neo.orbital_data;
  if (!orbital) {
    return null;
  }
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
    name: neo.name,
    color: neo.is_potentially_hazardous_asteroid ? 0xef4444 : 0x10b981,
    els: {
      a,
      e,
      i: i * DEG2RAD,
      Omega: Omega * DEG2RAD,
      omega: omega * DEG2RAD,
      M: M * DEG2RAD,
      epochJD,
    },
  };
}

function buildBodies(neos: NeoItem[]): Body[] {
  const bodies: Body[] = [];
  for (const neo of neos) {
    const body = orbitFromNeo(neo);
    if (body) {
      bodies.push(body);
    }
    if (bodies.length >= 50) {
      break;
    }
  }
  return bodies;
}

function sbdbValueFromOrbit(orbit: SbdbOrbit, keys: string[]): string | undefined {
  for (const key of keys) {
    const direct = (orbit as Record<string, unknown>)[key];
    if (typeof direct === 'string' && direct.trim() !== '') {
      return direct;
    }
  }

  const { elements } = orbit;
  if (Array.isArray(elements)) {
    for (const key of keys) {
      const found = elements.find(el => el.name === key || el.label === key);
      if (!found) {
        continue;
      }
      const value = found.value;
      if (value == null) {
        continue;
      }
      const asString = typeof value === 'string' ? value : String(value);
      if (asString.trim() !== '') {
        return asString;
      }
    }
  }

  return undefined;
}

function sbdbOrbitToRecord(orbit?: SbdbOrbit | null): SbdbOrbitRecord {
  if (!orbit) {
    throw new Error('No SBDB orbit');
  }
  const epochRaw = typeof orbit.epoch === 'string' && orbit.epoch.trim() !== '' ? orbit.epoch : undefined;
  const epochFallback = typeof orbit.cov_epoch === 'string' && orbit.cov_epoch.trim() !== '' ? orbit.cov_epoch : undefined;
  const epoch = epochRaw ?? epochFallback;
  const e = sbdbValueFromOrbit(orbit, ['e']);
  const i = sbdbValueFromOrbit(orbit, ['i']);
  const om = sbdbValueFromOrbit(orbit, ['om', 'node']);
  const w = sbdbValueFromOrbit(orbit, ['w', 'peri']);

  if (!epoch || !e || !i || !om || !w) {
    throw new Error('Incomplete SBDB orbit');
  }

  const record: SbdbOrbitRecord = { e, i, om, w, epoch };

  const a = sbdbValueFromOrbit(orbit, ['a']);
  if (a) {
    record.a = a;
  }

  const q = sbdbValueFromOrbit(orbit, ['q']);
  if (q) {
    record.q = q;
  }

  const ma = sbdbValueFromOrbit(orbit, ['ma', 'M']);
  if (ma) {
    record.ma = ma;
  }

  const M = sbdbValueFromOrbit(orbit, ['M', 'ma']);
  if (M) {
    record.M = M;
  }

  return record;
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

  const dateEl = document.getElementById('neo3d-date');
  const simulation = new Neo3D({ host: container, dateLabel: dateEl });

  try {
    for (const planet of ROUGH_PLANETS) {
      if (planet.name.toLowerCase() === 'earth') {
        simulation.setEarthElements(planet.els);
      } else {
        simulation.addBodies([
          {
            name: planet.name,
            color: planet.color,
            els: planet.els,
            orbit: { color: planet.color, segments: 720 },
          },
        ]);
      }
    }
    simulation.setPaused(false);
  } catch (error) {
    console.error('[horizons] planet preload failed', error); // eslint-disable-line no-console
  }

  let started = false;
  const apply = (neos: NeoItem[]) => {
    const bodies = buildBodies(neos);
    simulation.addBodies(bodies);
    simulation.setPaused(false);
    simulation.setTimeScale(86400);
    if (!started) {
      simulation.start();
      started = true;
    }
  };

  apply(getSelectedNeos());

  // UI wiring
  const speedSel = document.getElementById('neo3d-speed') as HTMLSelectElement | null;
  if (speedSel) {
    speedSel.value = '86400';
    speedSel.addEventListener('change', () => {
      const v = Number(speedSel.value);
      if (v === 0) simulation.setPaused(true);
      else {
        simulation.setPaused(false);
        simulation.setTimeScale(v);
      }
    });
  }

  const add3iBtn = document.getElementById('neo3d-load-3i') as HTMLButtonElement | null;
  if (add3iBtn) {
    const defaultLabel = add3iBtn.textContent ?? 'Add 3I/ATLAS';
    let loaded = false;
    add3iBtn.addEventListener('click', async () => {
      if (loaded) {
        return;
      }
      add3iBtn.disabled = true;
      add3iBtn.textContent = 'Loading…';
      try {
        const orbit = await loadInterstellar3I();
        if (!orbit) {
          throw new Error('3I orbit unavailable');
        }
        const record = sbdbOrbitToRecord(orbit);
        const els = fromSbdb(record);
        simulation.addBodies([
          {
            name: '3I/ATLAS',
            color: 0xdc2626,
            els,
            orbit: {
              color: 0xef4444,
              segments: 1200,
              spanDays: 2600,
            },
            label: '3I/ATLAS',
          },
        ]);
        loaded = true;
        add3iBtn.textContent = '3I/ATLAS added';
      } catch (error) {
        console.error('3I/ATLAS load failed', error);
        add3iBtn.disabled = false;
        add3iBtn.textContent = '3I unavailable';
        setTimeout(() => {
          if (!loaded) {
            add3iBtn.textContent = defaultLabel;
          }
        }, 3_000);
      }
    });
  }

  return {
    setNeos: apply,
  };
}
