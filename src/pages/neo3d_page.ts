import '../styles/main.css';
import { initNeo3D } from '../routes/neo3d';
import { getNeoBrowse } from '../api/fetch_neo';
import type { NeoItem } from '../types/nasa';

async function fetchDefaults(): Promise<NeoItem[]> {
  const page = await getNeoBrowse({ size: 20 });
  return page.near_earth_objects || [];
}

document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.classList.add('neo3d-fullscreen');
  document.body.classList.add('neo3d-fullscreen');
  const host = document.getElementById('neo3d-host');
  if (!host) return;
  let neos: NeoItem[] = [];
  try { neos = await fetchDefaults(); } catch (e) { console.error('NEO load failed', e); }
  await initNeo3D(() => neos);
});
