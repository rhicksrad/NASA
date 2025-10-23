import type { SbdbLookup } from '../api/sbdb';

interface ManualSbdbDefinition {
  primary: string;
  label: string;
  aliases: string[];
  lookup: SbdbLookup;
}

interface ManualSbdbEntry extends ManualSbdbDefinition {
  aliasKeys: Set<string>;
}

const normalize = (value: string): string => value.replace(/[^0-9a-z]/gi, '').toLowerCase();

const unique = <T>(values: T[]): T[] => {
  const seen = new Set<unknown>();
  const result: T[] = [];
  for (const value of values) {
    const key = typeof value === 'string' ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
};

const PN7_LOOKUP: SbdbLookup = {
  signature: {
    manual: true,
    message: 'Manual entry derived from MPEC 2025-Q232 pending SBDB ingestion',
    sources: [
      'https://en.wikipedia.org/wiki/2025_PN7',
      'https://minorplanetcenter.net/mpec/K25/K25QN2.html',
      'https://abcnews.go.com/US/earth-moons-orbiting-astronomers-explain-quasi-moon/story?id=126770774',
      'https://earthsky.org/space/earth-quasi-moon-2025-pn7/',
    ],
  },
  object: {
    fullname: '2025 PN7',
    des: '2025 PN7',
    object_name: '2025 PN7',
    kind: 'a',
    neo: true,
    pha: false,
    orbit_class: {
      code: 'APO',
      name: 'Apollo group · Arjuna subclass quasi-satellite',
    },
    discovery: {
      by: 'Pan-STARRS 1',
      date: '2025-08-02',
    },
    notes: 'Likely quasi-satellite of Earth through the 2080s; awaiting full SBDB publication.',
  },
  orbit: {
    epoch: 2460800.5,
    frame: 'ECLIPJ2000',
    elements: [
      { name: 'a', label: 'a', value: 1.0030197 },
      { name: 'e', label: 'e', value: 0.1075069 },
      { name: 'q', label: 'q', value: 0.8951882 },
      { name: 'Q', label: 'Q', value: 1.1108512 },
      { name: 'i', label: 'i', value: 1.97959 },
      { name: 'om', label: '\u03a9', value: 112.58068 },
      { name: 'w', label: '\u03c9', value: 81.04237 },
      { name: 'M', label: 'M', value: 19.12581 },
      { name: 'n', label: 'n', value: 0.98116008 },
      { name: 'tp', label: 'tp', value: 2460781.006942353 },
      { name: 'epoch', label: 'epoch', value: 2460800.5 },
      { name: 'per', label: 'P', value: 365.25 },
    ],
    reference: 'Discovery summaries; awaiting MPEC 2025-Q232 full element set',
  },
  phys_par: [
    { name: 'H', value: 26.36 },
    { name: 'G', value: 0.15 },
  ],
};

const DEFINITIONS: ManualSbdbDefinition[] = [
  {
    primary: '2025 PN7',
    label: '2025 PN7',
    aliases: ['PN7 2025', '2025PN7', 'PN7'],
    lookup: PN7_LOOKUP,
  },
];

const ENTRIES: ManualSbdbEntry[] = DEFINITIONS.map((definition) => {
  const aliases = unique([definition.primary, definition.label, ...definition.aliases]);
  const aliasKeys = new Set<string>();
  for (const alias of aliases) {
    const key = normalize(alias);
    if (!key) continue;
    aliasKeys.add(key);
  }
  return { ...definition, aliases, aliasKeys };
});

export function findManualSbdb(query: string) {
  const key = normalize(query);
  if (!key) return null;
  for (const entry of ENTRIES) {
    if (entry.aliasKeys.has(key)) {
      return {
        primary: entry.primary,
        label: entry.label,
        lookup: entry.lookup,
        aliases: entry.aliases,
      };
    }
  }
  return null;
}

export type ManualSbdbMatch = ReturnType<typeof findManualSbdb>;
