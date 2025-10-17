const JD_UNIX_EPOCH = 2440587.5;
const DAY_MS = 86_400_000;

export function jdFromDateUTC(date: Date): number {
  return date.getTime() / DAY_MS + JD_UNIX_EPOCH;
}

export function dateFromJulianDay(jd: number): Date {
  return new Date((jd - JD_UNIX_EPOCH) * DAY_MS);
}
