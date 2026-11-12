/** DONKI coronal-mass-ejection reports, joined and summarised by the worker. */
import { fetchJson, fetchText } from './worker';

export interface CmeAnalysis {
  isMostAccurate?: boolean;
  speed?: number | null;
  cmeSpeed?: number | null;
  halfAngle?: number | null;
  angularWidth?: number | null;
  /** WSA-ENLIL model runs that started from this measurement. */
  enlilList?: EnlilRun[] | null;
}

export interface ShockArrival {
  location?: string;
  arrivalTime?: string;
}

export interface EnlilRun {
  /** Modelled arrival at Earth; null when the run has the cloud missing us. */
  estimatedShockArrivalTime?: string | null;
  isEarthGB?: boolean | null;
  kp_135?: number | null;
  kp_180?: number | null;
  estimatedShockArrivals?: ShockArrival[] | null;
  impactList?: ShockArrival[] | null;
  kp_90?: number | null;
  kp90?: number | null;
  maxKp?: number | null;
}

export interface InterplanetaryShock {
  location?: string;
  eventTime?: string;
  time?: string;
}

export interface GeomagneticStorm {
  startTime?: string;
  allKpIndex?: Array<{ observedTime?: string; kpIndex: number }> | null;
}

export interface StormReport {
  cme?: {
    activityID?: string;
    startTime?: string | null;
    sourceLocation?: string | null;
    activeRegionNum?: number | null;
    note?: string | null;
    link?: string | null;
    instruments?: Array<{ displayName?: string }> | null;
  } | null;
  analyses?: CmeAnalysis[] | null;
  enlil?: EnlilRun[] | null;
  ips?: InterplanetaryShock[] | null;
  gst?: GeomagneticStorm[] | null;
}

export interface CmeListing {
  activityID: string;
  startTime?: string | null;
  sourceLocation?: string | null;
  activeRegionNum?: number | null;
  note?: string;
}

// Activity IDs contain colons ("2024-05-10T16:36:00-CME-001"); encodeURI keeps them readable.
const stormPath = (activityId: string, ext: 'md' | 'json') => `/storm/${encodeURI(activityId)}.${ext}`;

export function fetchStormReport(activityId: string, signal?: AbortSignal): Promise<StormReport> {
  return fetchJson<StormReport>(stormPath(activityId, 'json'), { signal });
}

export function fetchStormMarkdown(activityId: string, signal?: AbortSignal): Promise<string> {
  return fetchText(stormPath(activityId, 'md'), { signal, accept: 'text/markdown' });
}

export async function findCmes(start: string, end: string, signal?: AbortSignal): Promise<CmeListing[]> {
  const data = await fetchJson<{ items?: CmeListing[] }>('/storm/find', { params: { start, end }, signal });
  return data.items ?? [];
}
