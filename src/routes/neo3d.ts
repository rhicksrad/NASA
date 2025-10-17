import { getSbdb } from '../api/fetch_sbdb';
import type { NeoItem } from '../types/nasa';
import { fromSbdb } from '../utils/orbit';
import { Neo3D, type Body } from '../visuals/neo3d';

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

function applySpeedControls(sim: Neo3D): void {
  const speed = document.getElementById('neo3d-speed');
  if (!(speed instanceof HTMLSelectElement)) {
    return;
  }
  speed.addEventListener('change', () => {
    const value = Number(speed.value);
    if (value === 0) {
      sim.setPaused(true);
    } else {
      sim.setPaused(false);
      sim.setTimeScale(value);
    }
  });
}

function setupAtlasButton(sim: Neo3D): void {
  const button = document.getElementById('neo3d-load-3i');
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const defaultLabel = button.textContent ?? 'Add 3I/ATLAS';
  let loaded = false;
  button.addEventListener('click', async () => {
    if (loaded) {
      return;
    }
    button.disabled = true;
    button.textContent = 'Loading…';
    try {
      const response = await getSbdb('3I/ATLAS', true);
      const target = response.object;
      if (!target || !target.orbit) {
        throw new Error('No SBDB orbit for 3I/ATLAS');
      }
      const els = fromSbdb(target.orbit);
      sim.addBodies([
        {
          name: target.object_name ?? '3I/ATLAS',
          color: 0xdc2626,
          els,
        },
      ]);
      loaded = true;
      button.textContent = '3I/ATLAS added';
    } catch (error) {
      console.error('3I/ATLAS load failed', error);
      button.disabled = false;
      button.textContent = '3I unavailable';
      setTimeout(() => {
        if (!loaded) {
          button.textContent = defaultLabel;
        }
      }, 3_000);
    }
  });
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

  const simulation = new Neo3D({ host: container });
  const apply = (neos: NeoItem[]) => {
    const bodies = buildBodies(neos);
    simulation.addBodies(bodies);
    simulation.setPaused(false);
    simulation.setTimeScale(600);
  };

  apply(getSelectedNeos());
  simulation.start();

  applySpeedControls(simulation);
  setupAtlasButton(simulation);

  return {
    setNeos: apply,
  };
}
