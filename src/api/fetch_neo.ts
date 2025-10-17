import type { NeoBrowse } from '../types/nasa';
import { request } from './nasaClient';

export function getNeoBrowse(params: { page?: number; size?: number } = {}): Promise<NeoBrowse> {
  const q = { size: params.size ?? 5, ...(params.page !== undefined ? { page: params.page } : {}) };
  return request<NeoBrowse>('/neo/browse', q);
}
