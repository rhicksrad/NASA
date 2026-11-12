/** Rule-of-thumb planet taxonomy from radius, equilibrium temperature and mass. */
import type { PlanetArtKey } from './planetArt';

export interface PlanetMeasurements {
  /** Radius in Earth radii. */
  rade: number | null;
  /** Equilibrium temperature in kelvin. */
  eqt: number | null;
  /** Mass in Earth masses. */
  masse: number | null;
}

export interface PlanetType {
  label: string;
  description: string;
  art: PlanetArtKey;
}

interface Rule extends PlanetType {
  matches(radius: number, temperature: number | null, mass: number | null): boolean;
}

const UNKNOWN: PlanetType = {
  label: 'Unknown',
  description: 'No radius estimate is available for this world yet.',
  art: 'unknown',
};

const atLeast = (value: number | null, min: number) => value !== null && value >= min;
const atMost = (value: number | null, max: number) => value !== null && value <= max;

/** Evaluated top to bottom; the first match wins, so order encodes priority. */
const RULES: Rule[] = [
  {
    label: 'Lava world',
    description: 'A tidally roasted world with a magma ocean and vaporized rock atmosphere.',
    art: 'lava-world',
    matches: (r, t) => r < 1.5 && atLeast(t, 900),
  },
  {
    label: 'Airless dwarf',
    description: 'A tiny, likely airless body scarred by impacts and dominated by bare rock.',
    art: 'airless-dwarf',
    matches: (r) => r < 0.5,
  },
  {
    label: 'Temperate terrestrial',
    description: 'Earth-sized and receiving clement irradiation that could allow liquid water.',
    art: 'temperate-terrestrial',
    matches: (r, t) => r < 1.5 && atLeast(t, 240) && atMost(t, 330),
  },
  {
    label: 'Rocky terrestrial',
    description: 'Comparable in size to Earth and likely dominated by silicate rock and metal.',
    art: 'rocky',
    matches: (r) => r < 1.25,
  },
  {
    label: 'Mega-Earth',
    description: 'A super-dense terrestrial giant with crushing surface gravity and deep mantles.',
    art: 'mega-earth',
    matches: (r, _t, m) => r < 2 && atLeast(m, 10),
  },
  {
    label: 'Hot super-Earth',
    description: 'A volatile-rich super-Earth orbiting so close that its atmosphere is superheated.',
    art: 'hot-super-earth',
    matches: (r, t) => r < 2 && atLeast(t, 800),
  },
  {
    label: 'Super-Earth',
    description: 'Larger than Earth but smaller than ice giants, potentially with thick atmospheres.',
    art: 'super-earth',
    matches: (r) => r < 2,
  },
  {
    label: 'Hot sub-Neptune',
    description: 'A volatile sub-Neptune blasted by stellar radiation that puffs up hazy envelopes.',
    art: 'hot-sub-neptune',
    matches: (r, t) => r < 4 && atLeast(t, 800),
  },
  {
    label: 'Cold sub-Neptune',
    description: 'An intermediate world orbiting beyond the snow line with frigid upper clouds.',
    art: 'cold-sub-neptune',
    matches: (r, t) => r < 4 && atMost(t, 200),
  },
  {
    label: 'Sub-Neptune',
    description: 'Intermediate worlds with volatile-rich envelopes atop rocky cores.',
    art: 'sub-neptune',
    matches: (r) => r < 4,
  },
  {
    label: 'Warm Neptune',
    description: 'An ice giant analogue broiling enough to drive fast winds and dynamic clouds.',
    art: 'warm-neptune',
    matches: (r, t) => r < 6 && atLeast(t, 700),
  },
  {
    label: 'Neptune-like',
    description: 'Ice giant analogues with deep atmospheres of hydrogen, helium, and methane.',
    art: 'neptune',
    matches: (r) => r < 6,
  },
  {
    label: 'Ultra-hot Jupiter',
    description: 'A gas giant skimming its star, glowing from iron-vapor skies and supersonic jets.',
    art: 'ultra-hot-jupiter',
    matches: (_r, t) => atLeast(t, 1200),
  },
  {
    label: 'Cold gas giant',
    description: 'A distant gas giant with muted sunlight and high-altitude ammonia clouds.',
    art: 'cold-gas-giant',
    matches: (_r, t) => atMost(t, 350),
  },
  {
    label: 'Gas giant',
    description: 'Enormous planets with massive hydrogen-helium envelopes similar to Jupiter or Saturn.',
    art: 'gas-giant',
    matches: () => true,
  },
];

export function classifyPlanet({ rade, eqt, masse }: PlanetMeasurements): PlanetType {
  if (rade === null) return UNKNOWN;
  return RULES.find((rule) => rule.matches(rade, eqt, masse)) ?? UNKNOWN;
}
