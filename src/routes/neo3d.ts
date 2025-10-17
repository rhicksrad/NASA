import { request } from '../api/nasaClient';
import type { NeoItem } from '../types/nasa';
import { fromSbdb } from '../utils/orbit';
import { Neo3D, type Body } from '../visuals/neo3d';
import type { SbdbResponse } from '../types/sbdb';

function orbitFromNeo(neo: NeoItem): Body | null {
  const orbital = neo.orbital_data;
  if (!orbital) {
    return null;
  }
  return {
    name: neo.name,
    color: neo.is_potentially_hazardous_asteroid ? 0xef4444 : 0x10b981,
    els: {
      a: Number(orbital.semi_major_axis),
      e: Number(orbital.eccentricity),
      i: Number(orbital.inclination),
      Omega: Number(orbital.ascending_node_longitude),
      omega: Number(orbital.perihelion_argument),
      M: Number(orbital.mean_anomaly),
      epochJD: Number(orbital.epoch_osculation),
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
      else { simulation.setPaused(false); simulation.setTimeScale(v); }
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
        const response = await request<SbdbResponse>(
          'https://lively-haze-4b2c.hicksrch.workers.dev/sbdb?sstr=3I',
          {},
          { timeoutMs: 30_000 },
        );
        const target = response.object;
        if (!target || !target.orbit) {
          throw new Error('No SBDB orbit for 3I/ATLAS');
        }
        const els = fromSbdb(target.orbit);
        simulation.addBodies([
          {
            name: target.object_name ?? '3I/ATLAS',
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
