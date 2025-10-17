import type { SbdbResponse } from '../types/sbdb';
import { ensureSbdbOrbit, request } from './nasaClient';

export async function getSbdb(sstr: string, fullname = true) {
  const response = await request<SbdbResponse>(
    '/sbdb',
    { sstr, fullname: fullname ? 'true' : 'false' },
    { timeoutMs: 30_000 },
  );
  ensureSbdbOrbit(response);
  return response;
}
