import type { NeoBrowse, NeoFeed, NeoItem } from '../types/nasa';
import { request } from './nasaClient';

export function getNeoBrowse(params: { page?: number; size?: number } = {}) {
  const q = { size: params.size ?? 50, ...(params.page !== undefined ? { page: params.page } : {}) };
  return request<NeoBrowse>('/neo/browse', q);
}

export function getNeoFeed(params: { start_date: string; end_date: string }) {
  return request<NeoFeed>('/neo/feed', params);
}

export function getNeoById(id: string) {
  return request<NeoItem>(`/neo/${id}`);
}
