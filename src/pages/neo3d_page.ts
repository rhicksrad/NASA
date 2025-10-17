import '../styles/main.css';
import { initNeo3D } from '../routes/neo3d';
import { tryNeoBrowse } from '../api/nasaClient';
import type { NeoItem } from '../types/nasa';

async function fetchDefaults(): Promise<NeoItem[]> {
  const page = await tryNeoBrowse(20);
  return page?.near_earth_objects ?? [];
}

document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.classList.add('neo3d-fullscreen');
  document.body.classList.add('neo3d-fullscreen');
  const host = document.getElementById('neo3d-host');
  if (!host) return;
  let neos: NeoItem[] = [];
  try {
    neos = await fetchDefaults();
    if (!neos.length) {
      console.debug('[neo3d] NEO suggestions unavailable');
    }
  } catch (e) {
    console.debug('[neo3d] NEO suggestions unavailable', e);
  }
  await initNeo3D(() => neos);
});
