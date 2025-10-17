import '../styles/main.css';
import { initNeo3D } from '../routes/neo3d';
import { fetchNEOBrowse } from '../api/fetch_neo';
import { fetchPlanetElementsAtEpoch } from '../api/fetch_planets';
import { loadInterstellar3I } from '../neo3d';

interface NeoBrowseResponse {
  near_earth_objects?: unknown[];
}

document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.classList.add('neo3d-fullscreen');
  document.body.classList.add('neo3d-fullscreen');
  const host = document.getElementById('neo3d-host');
  if (!host) return;

  let neoSample: NeoBrowseResponse | null = null;

  try {
    // 1) Sample NEOs (verifies Worker/api_key wiring)
    const neo = await fetchNEOBrowse(20);
    neoSample = neo;
    console.info('[neo3d] NEO sample', neo?.near_earth_objects?.length);

    // 2) Planet elements at now (fixes Horizons TLIST format)
    const nowIso = new Date().toISOString();
    const ids = [199, 299, 399, 499, 599, 699, 799, 899];
    for (const id of ids) {
      try {
        const el = await fetchPlanetElementsAtEpoch(id, nowIso);
        console.info('[horizons] elements', id, el?.result?.slice?.(0, 120) ?? el);
      } catch (e) {
        console.warn('[horizons] failed for', id, e);
      }
    }

    // 3) Optional: interstellar 3I/ATLAS
    await loadInterstellar3I();
  } catch (e) {
    console.error('[neo3d] boot failed', e);
  }

  await initNeo3D(() => neoSample?.near_earth_objects ?? []);
});
