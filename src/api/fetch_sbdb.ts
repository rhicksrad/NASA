import { request } from './nasaClient';

// SBDB is keyless. Use sstr lookup, e.g. '3I' for 3I/ATLAS.
// Some records may not include "orbit"; caller must guard.
export async function fetchSBDB(sstr: string, fullname = true) {
  return request('/sbdb', { sstr, fullname });
}
