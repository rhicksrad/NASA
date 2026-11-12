/** Turns the filter form into an ADQL query for the Planetary Systems table. */
import { fahrenheitToKelvin, toNumber } from './units';

export const FILTER_KEYS = ['facility', 'yearMin', 'rMin', 'rMax', 'tMin', 'tMax'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
/** Raw form values; temperatures are entered in °F. */
export type Filters = Record<FilterKey, string>;

const SPACE_FACILITIES = ['TESS', 'Kepler', 'K2'];

export interface BuiltQuery {
  adql: string;
  /** Human-readable summary of the active filters. */
  description: string;
}

export function buildQuery(filters: Filters): BuiltQuery {
  // Only transiting planets have the measured radii this page is built around.
  const clauses = ['tran_flag=1'];
  const description: string[] = [];

  // Values are numeric or from a fixed list before they reach the query string.
  if (filters.facility === 'Ground') {
    clauses.push(...SPACE_FACILITIES.map((name) => `disc_facility not like '${name}'`));
    description.push('Facility: ground-based');
  } else if (SPACE_FACILITIES.includes(filters.facility)) {
    clauses.push(`disc_facility like '${filters.facility}'`);
    description.push(`Facility: ${filters.facility}`);
  }

  const numeric = (key: FilterKey, column: string, operator: '>=' | '<=', label: string) => {
    const value = toNumber(filters[key]);
    if (value !== null) {
      clauses.push(`${column} ${operator} ${value}`);
      description.push(`${label} ${operator === '>=' ? '≥' : '≤'} ${value}`);
    }
  };
  numeric('yearMin', 'disc_year', '>=', 'Year');
  numeric('rMin', 'pl_rade', '>=', 'Re');
  numeric('rMax', 'pl_rade', '<=', 'Re');

  const temperature = (key: FilterKey, operator: '>=' | '<=') => {
    const fahrenheit = toNumber(filters[key]);
    if (fahrenheit !== null) {
      clauses.push(`pl_eqt ${operator} ${fahrenheitToKelvin(fahrenheit).toFixed(2)}`);
      description.push(`Teq ${operator === '>=' ? '≥' : '≤'} ${fahrenheit} °F`);
    }
  };
  temperature('tMin', '>=');
  temperature('tMax', '<=');

  const adql = `SELECT TOP 1000 pl_name, hostname,
AVG(pl_rade) AS rade,
MIN(COALESCE(pl_bmasse, pl_masse)) AS masse,
MIN(pl_eqt)   AS eqt,
MIN(pl_orbper) AS period,
MIN(sy_dist) AS distance_pc,
MIN(ra) AS ra, MIN(dec) AS dec,
MIN(disc_year) AS disc_year
FROM ps
WHERE ${clauses.join(' AND ')}
GROUP BY pl_name, hostname
ORDER BY eqt`;

  return { adql, description: description.length ? description.join(' · ') : 'Every transiting planet on record, coolest first' };
}
