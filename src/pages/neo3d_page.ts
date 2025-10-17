import '../styles/main.css';
import { initNeo3D } from '../routes/neo3d';
import { tryNeoBrowse } from '../api/nasaClient';
import type { NeoItem } from '../types/nasa';

document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.classList.add('neo3d-fullscreen');
  document.body.classList.add('neo3d-fullscreen');
  const host = document.getElementById('neo3d-host');
  if (!host) return;

  let neos: NeoItem[] = [];
  try {
    const page = await tryNeoBrowse(20);
    neos = page?.near_earth_objects ?? [];
  } catch (error) {
    console.error('[neo3d] failed to load NEO suggestions', error);
  }

  await initNeo3D(() => neos);
});
