import type { SbdbResponse } from '../types/sbdb';
import { ensureSbdbOrbit, request } from './nasaClient';

type SbdbOptions = {
  fullname?: boolean;
};

export async function getSbdb(sstr: string, options: SbdbOptions = {}) {
  const params: Record<string, string> = { sstr };
  if (options.fullname !== undefined) {
    params.fullname = options.fullname ? 'true' : 'false';
  }
  const response = await request<SbdbResponse>('/sbdb', params, { timeoutMs: 30_000 });
  ensureSbdbOrbit(response);
  return response;
}
