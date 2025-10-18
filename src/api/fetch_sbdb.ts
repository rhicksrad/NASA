import type { SbdbResponse } from '../types/sbdb';
import { ensureSbdbOrbit, request } from './nasaClient';

export async function getSbdb(sstr: string) {
  const params: Record<string, string> = { sstr };
  const response = await request<SbdbResponse>('/sbdb', params, { timeoutMs: 30_000 });
  ensureSbdbOrbit(response);
  return response;
}
