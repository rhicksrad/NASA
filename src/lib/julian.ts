/** Julian date helpers. The site works in UTC and ignores the ~69 s TDB offset. */

const JD_UNIX_EPOCH = 2440587.5;
const DAY_MS = 86_400_000;

export function jdFromDate(date: Date): number {
  return JD_UNIX_EPOCH + date.getTime() / DAY_MS;
}

export function dateFromJd(jd: number): Date {
  return new Date((jd - JD_UNIX_EPOCH) * DAY_MS);
}
