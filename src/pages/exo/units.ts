/** Unit conversions and number formatting for the exoplanet table. */

const LY_PER_PARSEC = 3.261563777;

export const parsecsToLightYears = (pc: number | null): number | null => (pc === null ? null : pc * LY_PER_PARSEC);

export const kelvinToFahrenheit = (kelvin: number): number => ((kelvin - 273.15) * 9) / 5 + 32;

export const fahrenheitToKelvin = (fahrenheit: number): number => ((fahrenheit - 32) * 5) / 9 + 273.15;

/** Parses API or form input into a finite number, or null. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const DASH = '–';

export function formatNumber(value: number | null, digits = 2, placeholder = ''): string {
  return value === null ? placeholder : value.toFixed(digits);
}

export function formatTemperature(kelvin: number | null, placeholder = ''): string {
  return kelvin === null ? placeholder : kelvinToFahrenheit(kelvin).toFixed(0);
}

/** Light-years with precision that tapers as distances grow. */
export function formatLightYears(value: number | null, placeholder = DASH): string {
  if (value === null) return placeholder;
  const digits = value >= 1000 ? 0 : value >= 100 ? 1 : 2;
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Serialises rows as RFC 4180 CSV, quoting any field that needs it. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  const cell = (value: string | number | null) => {
    const text = value === null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
