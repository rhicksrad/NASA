import '../styles/main.css';
import { initNeo3D } from '../routes/neo3d';
import { getJSON, HttpError } from '../api/nasaClient';
import type { NeoBrowse, NeoItem } from '../types/nasa';

async function tryNeoBrowse(size = 20): Promise<NeoBrowse | null> {
  try {
    return await getJSON<NeoBrowse>(`/neo/browse?size=${size}`);
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 429)) {
      return null;
    }
    throw error;
  }
}

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
