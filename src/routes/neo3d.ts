import { Neo3D, type Body } from '../visuals/neo3d';
import type { NeoItem } from '../types/nasa';
import { getSbdb } from '../api/fetch_sbdb';
import { fromSbdb } from '../utils/orbit';

function elsFromNeo(n: NeoItem){
  const o=n.orbital_data!;
  return { a:Number(o.semi_major_axis), e:Number(o.eccentricity), i:Number(o.inclination),
           Omega:Number(o.ascending_node_longitude), omega:Number(o.perihelion_argument),
           M:Number(o.mean_anomaly), epochJD:Number(o.epoch_osculation) };
}

function mapNeos(neos:NeoItem[]):Body[]{
  return neos.slice(0,50).map((n,i)=>({ name:n.name, els:elsFromNeo(n), color: i%7===0?0xef4444:0x10b981 }));
}

export interface Neo3DController { setNeos(neos: NeoItem[]): void; }

export async function initNeo3D(getSelectedNeos:()=>NeoItem[]):Promise<Neo3DController|null>{
  const host=document.getElementById('neo3d-host') as HTMLDivElement | null; if(!host) return null;
  const sim=new Neo3D({host});
  sim.setBodies(mapNeos(getSelectedNeos()));
  sim.start();

  const speed=document.getElementById('neo3d-speed') as HTMLSelectElement|null;
  if(speed){ speed.addEventListener('change',()=>{ const v=Number(speed.value); if(v===0) sim.setPaused(true); else { sim.setPaused(false); sim.setTimeScale(v); } }); }

  const add3i=document.getElementById('neo3d-load-3i') as HTMLButtonElement|null;
  if(add3i){
    add3i.addEventListener('click', async ()=>{
      add3i.disabled=true;
      try{
        const res=await getSbdb('3I/ATLAS', true);
        const obj=res.object; if(!obj||!obj.orbit) throw new Error('No SBDB orbit');
        const els=fromSbdb(obj.orbit);
        sim.addBodies([{ name: obj.object_name || '3I/ATLAS', els, color: 0xdc2626 }]);
      }catch(e){ console.error('3I error', e); add3i.textContent='3I unavailable'; }
    });
  }

  return { setNeos(neos:NeoItem[]){ sim.setBodies(mapNeos(neos)); } };
}
