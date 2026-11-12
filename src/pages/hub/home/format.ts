/** Number and time formatting shared by the home page tiles. */

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const formatInt = (value: number): string => integer.format(Math.round(value));

export function formatLatitude(degrees: number): string {
  return `${Math.abs(degrees).toFixed(2)}° ${degrees >= 0 ? 'N' : 'S'}`;
}

export function formatLongitude(degrees: number): string {
  return `${Math.abs(degrees).toFixed(2)}° ${degrees >= 0 ? 'E' : 'W'}`;
}

/** "5 minutes ago", "3 hours ago", "2 days ago". */
export function formatAgo(then: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000));
  const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'} ago`;
  if (minutes < 60) return plural(Math.max(1, minutes), 'minute');
  if (minutes < 48 * 60) return plural(Math.round(minutes / 60), 'hour');
  return plural(Math.round(minutes / 1440), 'day');
}

/** A size people can picture, for an asteroid diameter in metres. */
export function describeSize(metres: number): string {
  if (metres < 8) return 'the size of a car';
  if (metres < 20) return 'the size of a bus';
  if (metres < 45) return 'the size of a house';
  if (metres < 90) return 'the size of an airliner';
  if (metres < 160) return 'as wide as a football field is long';
  if (metres < 400) return 'the size of a stadium';
  if (metres < 1000) return 'as wide as a skyscraper is tall';
  return 'more than a kilometre wide';
}

export const isoDay = (date: Date): string => date.toISOString().slice(0, 10);
