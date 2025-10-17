import '../styles/main.css';
import { initNeo3D } from '../routes/neo3d';
import { getNeoBrowse } from '../api/fetch_neo';
import type { NeoItem } from '../types/nasa';

async function fetchDefault():Promise<NeoItem[]>{ const page=await getNeoBrowse({size:20}); return page.near_earth_objects||[]; }

document.addEventListener('DOMContentLoaded', async ()=>{
  let neos:NeoItem[]=[];
  try{ neos=await fetchDefault(); }catch(e){ console.error('NEO load failed', e); }
  await initNeo3D(()=>neos);
});
