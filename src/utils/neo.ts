import type { NeoFeed } from '../types/nasa';

export interface NeoFlat {
  id: string;
  name: string;
  date: string;
  is_hazardous: boolean;
  miss_km: number | null;
  miss_ld: number | null;
  vel_kps: number | null;
  h_mag: number;
  dia_km_min: number | null;
  dia_km_max: number | null;
}

export function flattenFeed(feed: NeoFeed): NeoFlat[] {
  const out: NeoFlat[] = [];
  for (const [date, items] of Object.entries(feed.near_earth_objects || {})) {
    for (const it of items) {
      const ca = it.close_approach_data?.[0];
      const miss_km = ca?.miss_distance?.kilometers ? Number(ca.miss_distance.kilometers) : null;
      const miss_ld = ca?.miss_distance?.lunar ? Number(ca.miss_distance.lunar) : null;
      const vel_kps = ca?.relative_velocity?.kilometers_per_second ? Number(ca.relative_velocity.kilometers_per_second) : null;
      const km = it.estimated_diameter?.kilometers;
      out.push({
        id: it.id,
        name: it.name,
        date,
        is_hazardous: Boolean(it.is_potentially_hazardous_asteroid),
        miss_km,
        miss_ld,
        vel_kps,
        h_mag: it.absolute_magnitude_h,
        dia_km_min: km ? km.estimated_diameter_min : null,
        dia_km_max: km ? km.estimated_diameter_max : null,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
