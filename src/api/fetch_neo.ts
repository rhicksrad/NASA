import type { NeoBrowse, NeoFeed, NeoItem } from '../types/nasa';
import { request } from './nasaClient';

export function getNeoBrowse(params: { page?: number; size?: number } = {}) {
  const query = {
    size: params.size ?? 20,
    ...(params.page != null ? { page: params.page } : {}),
  };
  return request<NeoBrowse>('/neo/browse', query);
}

export function getNeoById(id: string) {
  return request<NeoItem>(`/neo/${id}`);
}

export function getNeoFeed(params: { start_date: string; end_date: string }) {
  return request<NeoFeed>('/neo/feed', params);
}
