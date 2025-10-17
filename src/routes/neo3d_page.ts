import '../styles/main.css';
import { tryNeoBrowse } from '../api/neo3dData';
import { initNeo3D } from './neo3d';
import type { NeoItem } from '../types/nasa';

document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.classList.add('neo3d-fullscreen');
  document.body.classList.add('neo3d-fullscreen');

  const host = document.getElementById('neo3d-host');
  if (!(host instanceof HTMLElement)) return;

  let neos: NeoItem[] = [];
  try {
    const page = await tryNeoBrowse(50);
    neos = page?.near_earth_objects ?? [];
  } catch {
    // tolerate missing browse data
  }

  await initNeo3D(() => neos, host);
});
