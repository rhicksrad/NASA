import type { SbdbResponse } from '../types/sbdb';
import { request } from './nasaClient';

export function getSbdb(sstr: string, fullname = true) {
  return request<SbdbResponse>(
    '/sbdb',
    { sstr, fullname: fullname ? 'true' : 'false' },
    { timeoutMs: 30_000 },
  );
}
