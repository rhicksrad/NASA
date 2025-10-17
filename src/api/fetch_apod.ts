import type { Apod } from '../types/nasa';
import { request } from './nasaClient';

export function getApod(params: { date?: string; hd?: 'true' | 'false' } = {}): Promise<Apod> {
  return request<Apod>('/apod', params);
}
