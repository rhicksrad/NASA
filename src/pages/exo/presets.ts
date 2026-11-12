/** Curated starting points for the exoplanet query form. Temperatures are in kelvin. */

export interface ExoPreset {
  key: string;
  label: string;
  description: string;
  yearMin: number;
  radius: [min: number | null, max: number | null];
  temperatureK: [min: number | null, max: number | null];
}

export const EXO_PRESETS: ExoPreset[] = [
  {
    key: 'lavaWorlds',
    label: 'Lava worlds',
    description: 'Curated sample: tidally roasted worlds with magma oceans and vaporized rock skies.',
    yearMin: 2000,
    radius: [0.4, 1.5],
    temperatureK: [900, null],
  },
  {
    key: 'airlessDwarfs',
    label: 'Airless dwarfs',
    description: 'Curated sample: tiny, likely airless bodies dominated by bare rock surfaces.',
    yearMin: 1995,
    radius: [null, 0.5],
    temperatureK: [null, 1200],
  },
  {
    key: 'temperateTerrestrials',
    label: 'Temperate terrestrials',
    description: 'Curated sample: Earth-sized planets receiving clement stellar irradiation.',
    yearMin: 2009,
    radius: [0.7, 1.5],
    temperatureK: [240, 330],
  },
  {
    key: 'rockyTerrestrials',
    label: 'Rocky terrestrials',
    description: 'Curated sample: compact rocky worlds similar in scale to the inner Solar System.',
    yearMin: 1995,
    radius: [0.5, 1.3],
    temperatureK: [120, 750],
  },
  {
    key: 'megaEarths',
    label: 'Mega-Earths',
    description: 'Curated sample: massive terrestrial giants with extreme surface gravity.',
    yearMin: 2005,
    radius: [1.4, 2],
    temperatureK: [null, 600],
  },
  {
    key: 'hotSuperEarths',
    label: 'Hot super-Earths',
    description: 'Curated sample: volatile-rich super-Earths orbiting scorchingly close to their stars.',
    yearMin: 2005,
    radius: [1, 2],
    temperatureK: [800, null],
  },
  {
    key: 'superEarths',
    label: 'Super-Earths',
    description: 'Curated sample: larger-than-Earth worlds with substantial atmospheres.',
    yearMin: 2009,
    radius: [1, 2],
    temperatureK: [200, 700],
  },
  {
    key: 'hotSubNeptunes',
    label: 'Hot sub-Neptunes',
    description: 'Curated sample: volatile sub-Neptunes puffed up by intense stellar heating.',
    yearMin: 2000,
    radius: [2, 4],
    temperatureK: [800, null],
  },
  {
    key: 'coldSubNeptunes',
    label: 'Cold sub-Neptunes',
    description: 'Curated sample: intermediate worlds orbiting beyond the snow line.',
    yearMin: 1995,
    radius: [1.5, 4],
    temperatureK: [null, 200],
  },
  {
    key: 'temperateSubNeptunes',
    label: 'Temperate sub-Neptunes',
    description: 'Curated sample: sub-Neptunes with moderate climates and thick envelopes.',
    yearMin: 2009,
    radius: [1.5, 4],
    temperatureK: [200, 650],
  },
  {
    key: 'warmNeptunes',
    label: 'Warm Neptunes',
    description: 'Curated sample: ice giant analogues broiling enough to drive fierce winds.',
    yearMin: 2000,
    radius: [3.5, 6],
    temperatureK: [700, null],
  },
  {
    key: 'neptuneLikes',
    label: 'Neptune-like worlds',
    description: 'Curated sample: classic ice giants with deep hydrogen-helium atmospheres.',
    yearMin: 1995,
    radius: [3.5, 6],
    temperatureK: [200, 650],
  },
  {
    key: 'ultraHotJupiters',
    label: 'Ultra-hot Jupiters',
    description: 'Curated sample: gas giants skimming their stars with iron-vapor skies.',
    yearMin: 2000,
    radius: [6, null],
    temperatureK: [1200, null],
  },
  {
    key: 'coldGasGiants',
    label: 'Cold gas giants',
    description: 'Curated sample: distant gas giants bathed in muted sunlight and ammonia clouds.',
    yearMin: 1995,
    radius: [6, null],
    temperatureK: [null, 350],
  },
  {
    key: 'gasGiants',
    label: 'Gas giants',
    description: 'Curated sample: Jupiter and Saturn analogues with massive hydrogen envelopes.',
    yearMin: 1995,
    radius: [6, null],
    temperatureK: [350, 1200],
  },
];
