import '../styles/main.css';
import { initNeo3D } from '../routes/neo3d';
import { tryNeoBrowse } from '../api/neo3dData';
import type { NeoItem } from '../types/nasa';

document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.classList.add('neo3d-fullscreen');
  document.body.classList.add('neo3d-fullscreen');

  const host = document.getElementById('neo3d-host');
  if (!host) return;

  let neos: NeoItem[] = [];

  // Initialize the scene immediately with whatever we have
  const controller = await initNeo3D(() => neos, host);

  // Fetch NEO suggestions opportunistically; tolerate 401/429
  try {
    const page = await tryNeoBrowse(20); // returns null on 401/429
    if (page?.near_earth_objects?.length) {
      neos = page.near_earth_objects;
      controller?.setNeos(neos);
    }
  } catch (error) {
    // Non-auth errors only
    // eslint-disable-next-line no-console
    console.debug('[neo3d] NEO suggestions unavailable', error);
  }
});
