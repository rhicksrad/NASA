/** Turns NeoWs catalogue records into scene-ready small bodies and list labels. */
import type { NeoItem } from '../../api/neo';
import type { Keplerian } from '../../orbits/kepler';
import type { SmallBodySpec } from './scene/Neo3D';

const DEG2RAD = Math.PI / 180;

function parseNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

export type NeoCandidate = {
  neo: NeoItem;
  spec: SmallBodySpec;
  normalizedKeys: string[];
  nameKey: string | null;
  allowWeakName: boolean;
};

export function normalizeEntryKey(value: string): string {
  return value.trim().toLowerCase();
}

function isCometLike(neo: NeoItem): boolean {
  const designation = typeof neo.designation === 'string' ? neo.designation.trim() : '';
  if (designation.includes('/')) return true;
  const orbitType = neo.orbital_data?.orbit_class?.orbit_class_type;
  return typeof orbitType === 'string' && /comet/i.test(orbitType);
}

export function getNeoDisplayName(neo: NeoItem): string {
  const designation = typeof neo.designation === 'string' ? neo.designation.trim() : '';
  const name = typeof neo.name === 'string' ? neo.name.trim() : '';
  if (designation) {
    if (designation.includes('/') || !name) {
      return designation;
    }
  }
  if (name) return name;
  if (designation) return designation;
  const id =
    (typeof neo.id === 'string' && neo.id.trim()) ||
    (typeof neo.neo_reference_id === 'string' && neo.neo_reference_id.trim()) ||
    '';
  return id ? `NEO ${id}` : 'Near-Earth Object';
}

export function createNeoCandidate(neo: NeoItem): NeoCandidate | null {
  const orbital = neo.orbital_data;
  if (!orbital) return null;

  const a = parseNumber(orbital.semi_major_axis);
  const e = parseNumber(orbital.eccentricity);
  const i = parseNumber(orbital.inclination);
  const Omega = parseNumber(orbital.ascending_node_longitude);
  const omega = parseNumber(orbital.perihelion_argument);
  const M = parseNumber(orbital.mean_anomaly);
  const epochJD = parseNumber(orbital.epoch_osculation);

  if (
    !Number.isFinite(a) ||
    !Number.isFinite(e) ||
    !Number.isFinite(i) ||
    !Number.isFinite(Omega) ||
    !Number.isFinite(omega) ||
    !Number.isFinite(M) ||
    !Number.isFinite(epochJD)
  ) {
    return null;
  }

  const els: Keplerian = {
    a,
    e,
    i: i * DEG2RAD,
    Omega: Omega * DEG2RAD,
    omega: omega * DEG2RAD,
    M: M * DEG2RAD,
    epochJD,
  };

  const color = neo.is_potentially_hazardous_asteroid ? 0xef4444 : 0x22d3ee;
  const segments = e < 1 ? 720 : 1600;
  const orbit: NonNullable<SmallBodySpec['orbit']> = {
    color,
    segments,
    spanDays: e < 1 ? undefined : 3200,
  };

  const displayName = getNeoDisplayName(neo);
  const diameterMin = neo.estimated_diameter?.kilometers?.estimated_diameter_min;
  const diameterMax = neo.estimated_diameter?.kilometers?.estimated_diameter_max;
  let diameterKm: number | undefined;
  if (typeof diameterMin === 'number' && typeof diameterMax === 'number') {
    const avg = (diameterMin + diameterMax) / 2;
    if (Number.isFinite(avg) && avg > 0) {
      diameterKm = avg;
    }
  }

  const orbitClass = neo.orbital_data?.orbit_class;
  const spec: SmallBodySpec = {
    id:
      (typeof neo.id === 'string' && neo.id.trim()) ||
      (typeof neo.neo_reference_id === 'string' && neo.neo_reference_id.trim()) ||
      undefined,
    name: displayName,
    label: displayName,
    color,
    els,
    orbit,
    absMag: typeof neo.absolute_magnitude_h === 'number' ? neo.absolute_magnitude_h : undefined,
    diameterKm,
    bodyType: orbitClass?.orbit_class_type,
    orbitClass: orbitClass?.orbit_class_description,
    kindHint: isCometLike(neo) ? 'comet' : undefined,
  };

  const keys = new Set<string>();
  const pushKey = (value: string | number | null | undefined) => {
    if (value == null) return;
    const normalized = normalizeEntryKey(String(value));
    if (!normalized || normalized === 'null' || normalized === 'undefined') return;
    keys.add(normalized);
  };

  pushKey(neo.id);
  pushKey(neo.neo_reference_id);
  pushKey(neo.designation);

  let nameKey: string | null = null;
  if (typeof neo.name === 'string') {
    const normalized = normalizeEntryKey(neo.name);
    if (normalized && normalized !== 'null' && normalized !== 'undefined') {
      nameKey = normalized;
      keys.add(normalized);
    }
  }

  return {
    neo,
    spec,
    normalizedKeys: Array.from(keys),
    nameKey,
    allowWeakName: isCometLike(neo),
  };
}

export function orbitColorFromEccentricity(e: number | undefined): string {
  const ecc = typeof e === 'number' && Number.isFinite(e) ? Math.max(0, e) : Number.NaN;
  const hue = Number.isFinite(ecc) ? 160 + Math.min(60, ecc * 120) : 185;
  return `hsl(${hue} 70% 50%)`;
}

export function formatNeoSize(neo: NeoItem): string | null {
  const km = neo.estimated_diameter?.kilometers;
  if (!km) return null;
  const { estimated_diameter_min: min, estimated_diameter_max: max } = km;
  if (!(Number.isFinite(min) && Number.isFinite(max))) return null;
  const avgKm = (min + max) / 2;
  if (!Number.isFinite(avgKm) || avgKm <= 0) return null;
  if (avgKm >= 1) {
    return `${avgKm.toFixed(1)} km`;
  }
  const avgMeters = avgKm * 1000;
  if (avgMeters >= 1) {
    return `${avgMeters.toFixed(0)} m`;
  }
  return `${(avgMeters * 100).toFixed(0)} cm`;
}

export function formatNextApproach(neo: NeoItem): string | null {
  const next = neo.next;
  if (!next) return null;
  // "2040-Mar-12 10:58" reads better as "12 Mar 2040".
  const [year, month, day] = next.date.split(' ')[0].split('-');
  const when = year && month && day ? `${Number(day)} ${month} ${year}` : next.date;
  const extras: string[] = [];
  const distance = Number(next.distAu);
  if (Number.isFinite(distance) && distance > 0) extras.push(`${distance.toFixed(3)} AU away`);
  const speed = Number(next.vRelKms);
  if (Number.isFinite(speed) && speed > 0) extras.push(`${speed.toFixed(1)} km/s`);
  return [when, ...extras].join(', ');
}
