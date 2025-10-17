import { fetchSBDB } from './api/fetch_sbdb';

export async function loadInterstellar3I() {
  try {
    const data = await fetchSBDB('3I', true);
    if (!data || !data.orbit) {
      throw new Error('No SBDB orbit in response for 3I');
    }
    // TODO: convert data.orbit.elements into your renderer’s orbit model
    // This is where you build geometry/curve from a,e,i,om,w,ma,epoch, etc.
    return data.orbit;
  } catch (e) {
    console.error('3I/ATLAS load failed', e);
    // Surface non-fatal banner in UI if you have a toast system
    return null;
  }
}
