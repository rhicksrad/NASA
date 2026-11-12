/** Derives the headline numbers for a CME report from the raw DONKI records. */
import type { EnlilRun, StormReport } from '../../api/donki';

export type TimelineEvent =
  | { kind: 'launch'; t: Date }
  | { kind: 'pred'; t: Date; label: string; kp: number | null }
  | { kind: 'ips'; t: Date }
  | { kind: 'gst'; t: Date }
  | { kind: 'kp'; t: Date; kp: number };

export interface StormSummary {
  /** When the eruption was first seen leaving the Sun. */
  launch: Date | null;
  /** Leading-edge speed in km/s. */
  speed: number | null;
  /** Full angular width in degrees. */
  width: number | null;
  speedBand: string;
  widthBand: string;
  /** Highest Kp reading of the linked geomagnetic storm; 0 when there was none. */
  peakKp: number;
  /** Highest Kp any model run expected (90° clock angle), when the models had it reaching Earth. */
  forecastKp: number | null;
  /** Smallest gap between any predicted arrival and the observed shock at Earth, in ms. */
  forecastErrorMs: number | null;
  /** Delay from the observed shock to the start of the geomagnetic storm, in ms. */
  shockToStormMs: number | null;
  /** Where else the models had the cloud arriving, earliest first. */
  otherArrivals: Array<{ label: string; t: Date }>;
  events: TimelineEvent[];
}

const AU_KM = 149_597_870.7;

function parseTime(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function speedBand(speed: number | null): string {
  if (speed == null) return 'unknown';
  if (speed >= 2000) return 'extreme';
  if (speed >= 1500) return 'very fast';
  if (speed >= 1000) return 'fast';
  if (speed >= 700) return 'moderate';
  return 'slow';
}

function widthBand(width: number | null): string {
  if (width == null) return 'unknown';
  if (width >= 260) return 'full halo';
  if (width >= 180) return 'partial halo';
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

/** NOAA's G-scale name for a Kp value, or null below storm level. */
export function stormScale(kp: number): string | null {
  if (kp >= 9) return 'G5, extreme';
  if (kp >= 8) return 'G4, severe';
  if (kp >= 7) return 'G3, strong';
  if (kp >= 6) return 'G2, moderate';
  if (kp >= 5) return 'G1, minor';
  return null;
}

/** Hours a cloud holding this speed would take to cross one astronomical unit. */
export function transitHours(speed: number): number {
  return AU_KM / speed / 3600;
}

export function summarizeStorm(report: StormReport): StormSummary {
  const analyses = report.analyses ?? [];
  const analysis = analyses.find((entry) => entry.isMostAccurate) ?? analyses[0] ?? {};
  const speed = analysis.speed ?? analysis.cmeSpeed ?? null;
  const width = analysis.halfAngle ? analysis.halfAngle * 2 : (analysis.angularWidth ?? null);

  const events: TimelineEvent[] = [];
  const launch = parseTime(report.cme?.startTime);
  if (launch) events.push({ kind: 'launch', t: launch });

  // Model runs arrive either at the top level or nested under the measurement they started from.
  const runs: EnlilRun[] = [...(report.enlil ?? []), ...analyses.flatMap((entry) => entry.enlilList ?? [])];
  const others = new Map<string, Date>();
  let forecastKp: number | null = null;

  for (const run of runs) {
    const kp = run.kp_90 ?? run.kp90 ?? run.maxKp ?? null;
    const earth = parseTime(run.estimatedShockArrivalTime);
    if (earth) events.push({ kind: 'pred', t: earth, label: 'Earth', kp });
    // `estimatedShockArrivals` is often an empty list, so merge rather than pick one.
    for (const arrival of [...(run.estimatedShockArrivals ?? []), ...(run.impactList ?? [])]) {
      const t = parseTime(arrival.arrivalTime);
      if (!t) continue;
      const label = arrival.location || 'Target';
      if (label.toLowerCase() === 'earth') {
        events.push({ kind: 'pred', t, label: 'Earth', kp });
      } else if (!others.has(label) || t < (others.get(label) as Date)) {
        others.set(label, t);
      }
    }
    const reachesEarth = earth !== null || (run.estimatedShockArrivals ?? []).some((a) => (a.location ?? '').toLowerCase() === 'earth');
    if (reachesEarth && kp !== null) forecastKp = Math.max(forecastKp ?? 0, kp);
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
    launch,
    speed,
    width,
    speedBand: speedBand(speed),
    widthBand: widthBand(width),
    peakKp,
    forecastKp,
    forecastErrorMs:
      observed !== undefined && predicted.length
        ? Math.min(...predicted.map((time) => Math.abs(time - observed)))
        : null,
    shockToStormMs: observed !== undefined && stormStart !== undefined ? stormStart - observed : null,
    otherArrivals: [...others]
      .map(([label, t]) => ({ label, t }))
      .sort((a, b) => a.t.getTime() - b.t.getTime()),
    events,
  };
}

export function formatHours(ms: number): string {
  return (ms / 3_600_000).toFixed(1);
}
