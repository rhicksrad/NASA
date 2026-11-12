/** Derives the headline numbers for a CME report from the raw DONKI records. */
import type { StormReport } from '../../api/donki';

export type TimelineEvent =
  | { kind: 'pred'; t: Date; label: string; kp: number | null }
  | { kind: 'ips'; t: Date }
  | { kind: 'gst'; t: Date }
  | { kind: 'kp'; t: Date; kp: number };

export interface StormSummary {
  speedBand: string;
  widthBand: string;
  peakKp: number;
  /** Smallest gap between any predicted arrival and the observed shock at Earth, in ms. */
  forecastErrorMs: number | null;
  /** Delay from the observed shock to the start of the geomagnetic storm, in ms. */
  shockToStormMs: number | null;
  events: TimelineEvent[];
}

function parseTime(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function speedBand(speed: number | null): string {
  if (speed == null) return 'unknown';
  if (speed >= 2000) return 'hyper';
  if (speed >= 1500) return 'very fast';
  if (speed >= 1000) return 'fast';
  if (speed >= 700) return 'moderate';
  return 'slow';
}

function widthBand(width: number | null): string {
  if (width == null) return 'unknown';
  if (width >= 260) return 'full-halo-ish';
  if (width >= 180) return 'broad';
  if (width >= 120) return 'wide';
  return 'narrow';
}

/** Equatorward edge of the auroral oval for a given Kp (NOAA rule of thumb), in degrees. */
export function auroraLatitude(kp: number): number {
  if (kp >= 9) return 45;
  if (kp >= 8) return 47;
  if (kp >= 7) return 50;
  if (kp >= 6) return 54;
  if (kp >= 5) return 58;
  if (kp >= 4) return 61;
  if (kp >= 3) return 65;
  return 67;
}

export function summarizeStorm(report: StormReport): StormSummary {
  const analysis = report.analyses?.[0] ?? {};
  const speed = analysis.speed ?? analysis.cmeSpeed ?? null;
  const width = analysis.halfAngle ? analysis.halfAngle * 2 : (analysis.angularWidth ?? null);

  const events: TimelineEvent[] = [];

  for (const run of report.enlil ?? []) {
    const kp = run.kp_90 ?? run.kp90 ?? run.maxKp ?? null;
    // `estimatedShockArrivals` is often an empty list, so merge rather than pick one.
    for (const arrival of [...(run.estimatedShockArrivals ?? []), ...(run.impactList ?? [])]) {
      const t = parseTime(arrival.arrivalTime);
      if (t) events.push({ kind: 'pred', t, label: arrival.location || 'Target', kp });
    }
  }

  for (const shock of report.ips ?? []) {
    if ((shock.location ?? '').toLowerCase() !== 'earth') continue;
    const t = parseTime(shock.eventTime ?? shock.time);
    if (t) events.push({ kind: 'ips', t });
  }

  let peakKp = 0;
  for (const storm of report.gst ?? []) {
    const start = parseTime(storm.startTime);
    if (start) events.push({ kind: 'gst', t: start });
    for (const reading of storm.allKpIndex ?? []) {
      if (!Number.isFinite(reading.kpIndex)) continue;
      peakKp = Math.max(peakKp, reading.kpIndex);
      const t = parseTime(reading.observedTime);
      if (t) events.push({ kind: 'kp', t, kp: reading.kpIndex });
    }
  }

  events.sort((a, b) => a.t.getTime() - b.t.getTime());

  const predicted = events.filter((event) => event.kind === 'pred').map((event) => event.t.getTime());
  const observed = events.find((event) => event.kind === 'ips')?.t.getTime();
  const stormStart = events.find((event) => event.kind === 'gst')?.t.getTime();

  return {
    speedBand: speedBand(speed),
    widthBand: widthBand(width),
    peakKp,
    forecastErrorMs:
      observed !== undefined && predicted.length
        ? Math.min(...predicted.map((time) => Math.abs(time - observed)))
        : null,
    shockToStormMs: observed !== undefined && stormStart !== undefined ? stormStart - observed : null,
    events,
  };
}

export const formatHours = (ms: number): string => (ms / 3_600_000).toFixed(1);
