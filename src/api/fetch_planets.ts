import { request } from './nasaClient';

// Convert ISO to Horizons CAL format `YYYY-MM-DD HH:MM:SS` in UTC
function isoToCalUTC(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const s = pad(d.getUTCSeconds());
  return `${y}-${m}-${day} ${h}:${mi}:${s}`;
}

// Fetch osculating elements for a major body SPK-ID at a single epoch.
// Example SPK-IDs: 199 Mercury, 299 Venus, 399 Earth, 499 Mars, 599 Jupiter, 699 Saturn, 799 Uranus, 899 Neptune
export async function fetchPlanetElementsAtEpoch(spkId: number | string, epochIso: string) {
  const cal = isoToCalUTC(epochIso);

  // Horizons requires single quotes around COMMAND and TLIST values.
  return request('/horizons', {
    COMMAND: `'${spkId}'`,
    EPHEM_TYPE: 'ELEMENTS',
    MAKE_EPHEM: 'YES',
    OBJ_DATA: 'NO',
    TLIST: `'${cal}'`,
    TLIST_TYPE: 'CAL',
    TIME_TYPE: 'UTC',
    OUT_UNITS: 'AU-D',
    REF_PLANE: 'ECLIPTIC',
    REF_SYSTEM: 'J2000',
    format: 'json',
  });
}
