import { request } from './nasaClient';

export type ArtemisVectorRow = {
  jdtdb: number;
  calendarUtc: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
};

export type ArtemisTimelineResponse = {
  ok: boolean;
  mission: {
    name: string;
    pagePath: string;
    pageSlug: string;
    objects: { orion: string; moon: string };
    center: string;
    suggestedEndpoints: {
      track: string;
      orion: string;
      moon: string;
      article: string;
    };
  };
};

export type ArtemisArticleResponse = {
  ok: boolean;
  source: string;
  post: {
    id: number;
    date: string;
    modified: string;
    slug: string;
    link: string;
    title: string;
    excerpt: string;
  } | null;
};

type ArtemisVectorPayload = { ok?: boolean; error?: string; text?: string };

export type ArtemisTrackResponse = {
  ok: boolean;
  mission: {
    name: string;
    pagePath: string;
    pageSlug: string;
    trackedObjects: { orion: string; moon: string; center: string };
  };
  window: { start: string; stop: string; step: string; format: string };
  article: ArtemisArticleResponse;
  vectors: { orion: ArtemisVectorPayload; moon: ArtemisVectorPayload };
  parsed?: { orion: ArtemisVectorRow[]; moon: ArtemisVectorRow[] };
};

export type ArtemisTrackOptions = {
  start?: string;
  stop?: string;
  step?: string;
  format?: 'json' | 'text';
};

export function getArtemisTimeline(signal?: AbortSignal) {
  return request<ArtemisTimelineResponse>('/artemis/timeline', {}, { signal });
}

export function getArtemisArticle(signal?: AbortSignal) {
  return request<ArtemisArticleResponse>('/artemis/article', {}, { signal });
}

export function getArtemisTrack(options: ArtemisTrackOptions = {}, signal?: AbortSignal) {
  const params: Record<string, string> = {};
  if (options.start) params.start = options.start;
  if (options.stop) params.stop = options.stop;
  if (options.step) params.step = options.step;
  if (options.format) params.format = options.format;
  return request<ArtemisTrackResponse>('/artemis/track', params, { signal, timeoutMs: 45_000 });
}
