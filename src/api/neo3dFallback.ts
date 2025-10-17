import type { NeoBrowse, NeoItem } from '../types/nasa';

const FALLBACK_NEOS: NeoItem[] = [
  {
    id: '2000433',
    name: '433 Eros (A898 PA)',
    absolute_magnitude_h: 10.39,
    estimated_diameter: {
      kilometers: {
        estimated_diameter_min: 22.2103282246,
        estimated_diameter_max: 49.6638037128,
      },
      meters: {
        estimated_diameter_min: 22210.3282245866,
        estimated_diameter_max: 49663.8037127578,
      },
      miles: {
        estimated_diameter_min: 13.8008538592,
        estimated_diameter_max: 30.8596473768,
      },
      feet: {
        estimated_diameter_min: 72868.5332523526,
        estimated_diameter_max: 162938.9937729642,
      },
    },
    is_potentially_hazardous_asteroid: false,
    close_approach_data: [
      {
        close_approach_date: '1931-01-30',
        close_approach_date_full: '1931-Jan-30 04:07',
        epoch_date_close_approach: -1228247580000,
        relative_velocity: {
          kilometers_per_second: '5.9208185341',
          kilometers_per_hour: '21314.9467227704',
          miles_per_hour: '13244.2789789347',
        },
        miss_distance: {
          astronomical: '0.1740731458',
          lunar: '67.7144537162',
          kilometers: '26040971.835879446',
          miles: '16181109.5707945148',
        },
        orbiting_body: 'Earth',
      },
      {
        close_approach_date: '2012-01-31',
        close_approach_date_full: '2012-Jan-31 02:58',
        epoch_date_close_approach: 1327988280000,
        relative_velocity: {
          kilometers_per_second: '5.6649530435',
          kilometers_per_hour: '20393.8309567038',
          miles_per_hour: '12674.4609377052',
        },
        miss_distance: {
          astronomical: '0.1789779692',
          lunar: '69.6174268188',
          kilometers: '26778038.924116204',
          miles: '16638508.739531415',
        },
        orbiting_body: 'Earth',
      },
      {
        close_approach_date: '2174-02-03',
        close_approach_date_full: '2174-Feb-03 01:30',
        epoch_date_close_approach: 6440520600000,
        relative_velocity: {
          kilometers_per_second: '6.0055431713',
          kilometers_per_hour: '21619.9554168322',
          miles_per_hour: '13433.7995199755',
        },
        miss_distance: {
          astronomical: '0.1884002692',
          lunar: '73.2877047188',
          kilometers: '28184278.979746604',
          miles: '17512898.8741029752',
        },
        orbiting_body: 'Earth',
      },
    ],
    orbital_data: {
      orbit_id: '659',
      orbit_determination_date: '2021-05-24 17:55:05',
      first_observation_date: '1893-10-29',
      last_observation_date: '2021-05-13',
      data_arc_in_days: '46582',
      observations_used: '9130',
      orbit_uncertainty: '0',
      minimum_orbit_intersection: '0.148353',
      jupiter_tisserand_invariant: '4.582',
      epoch_osculation: '2461000.5',
      eccentricity: '0.2228359407071628',
      semi_major_axis: '1.458120998474684',
      inclination: '10.82846651399785',
      ascending_node_longitude: '304.2701025753316',
      orbital_period: '643.1151986547006',
      perihelion_distance: '1.13319923411471',
      perihelion_argument: '178.9297536744151',
      aphelion_distance: '1.783042762834657',
      perihelion_time: '2461088.831287055474',
      mean_anomaly: '310.5543277370992',
      mean_motion: '0.5597752949285997',
      equinox: 'J2000',
      orbit_class: {
        orbit_class_type: 'AMO',
        orbit_class_description: 'Near-Earth asteroid orbits similar to that of 1221 Amor',
        orbit_class_range: '1.017 AU < q (perihelion) < 1.3 AU',
      },
    },
    links: {
      self: 'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=433',
    },
    nasa_jpl_url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=433',
    is_sentry_object: false,
  },
  {
    id: '2004660',
    name: '4660 Nereus (1982 DB)',
    absolute_magnitude_h: 18.1,
    estimated_diameter: {
      kilometers: {
        estimated_diameter_min: 0.3,
        estimated_diameter_max: 0.5,
      },
      meters: {
        estimated_diameter_min: 300,
        estimated_diameter_max: 500,
      },
      miles: {
        estimated_diameter_min: 0.1864113,
        estimated_diameter_max: 0.3106855,
      },
      feet: {
        estimated_diameter_min: 984.252,
        estimated_diameter_max: 1640.42,
      },
    },
    is_potentially_hazardous_asteroid: true,
    close_approach_data: [
      {
        close_approach_date: '2021-12-11',
        close_approach_date_full: '2021-Dec-11 13:51',
        epoch_date_close_approach: 1639230660000,
        relative_velocity: {
          kilometers_per_second: '6.578',
          kilometers_per_hour: '23680.8',
          miles_per_hour: '14717.7',
        },
        miss_distance: {
          astronomical: '0.0263',
          lunar: '10.2',
          kilometers: '3930000',
          miles: '2442000',
        },
        orbiting_body: 'Earth',
      },
      {
        close_approach_date: '2031-12-11',
        close_approach_date_full: '2031-Dec-11 03:42',
        epoch_date_close_approach: 1954726920000,
        relative_velocity: {
          kilometers_per_second: '6.302',
          kilometers_per_hour: '22687.2',
          miles_per_hour: '14100.9',
        },
        miss_distance: {
          astronomical: '0.0275',
          lunar: '10.7',
          kilometers: '4120000',
          miles: '2560000',
        },
        orbiting_body: 'Earth',
      },
    ],
    orbital_data: {
      orbit_id: '220',
      orbit_determination_date: '2024-06-17 00:00:00',
      first_observation_date: '1981-09-16',
      last_observation_date: '2023-12-15',
      data_arc_in_days: '15450',
      observations_used: '5160',
      orbit_uncertainty: '0',
      minimum_orbit_intersection: '0.0098',
      jupiter_tisserand_invariant: '5.88',
      epoch_osculation: '2461000.5',
      eccentricity: '0.359',
      semi_major_axis: '1.48',
      inclination: '1.45',
      ascending_node_longitude: '313',
      orbital_period: '678.5',
      perihelion_distance: '0.95',
      perihelion_argument: '160',
      aphelion_distance: '2.01',
      perihelion_time: '2461155.2',
      mean_anomaly: '49.8',
      mean_motion: '0.530',
      equinox: 'J2000',
      orbit_class: {
        orbit_class_type: 'APO',
        orbit_class_description: 'Near-Earth asteroid orbits crossing Earth with a > 1 AU',
        orbit_class_range: 'q < 1.017 AU',
      },
    },
    links: {
      self: 'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=4660',
    },
    nasa_jpl_url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=4660',
    is_sentry_object: false,
  },
  {
    id: '99942',
    name: '99942 Apophis (2004 MN4)',
    absolute_magnitude_h: 19.7,
    estimated_diameter: {
      kilometers: {
        estimated_diameter_min: 0.34,
        estimated_diameter_max: 0.38,
      },
      meters: {
        estimated_diameter_min: 340,
        estimated_diameter_max: 380,
      },
      miles: {
        estimated_diameter_min: 0.21126614,
        estimated_diameter_max: 0.23612098,
      },
      feet: {
        estimated_diameter_min: 1115.4856,
        estimated_diameter_max: 1246.7192,
      },
    },
    is_potentially_hazardous_asteroid: true,
    close_approach_data: [
      {
        close_approach_date: '2029-04-13',
        close_approach_date_full: '2029-Apr-13 21:46',
        epoch_date_close_approach: 1870811160000,
        relative_velocity: {
          kilometers_per_second: '7.42',
          kilometers_per_hour: '26712',
          miles_per_hour: '16600',
        },
        miss_distance: {
          astronomical: '0.000254',
          lunar: '0.099',
          kilometers: '38000',
          miles: '23600',
        },
        orbiting_body: 'Earth',
      },
      {
        close_approach_date: '2036-04-13',
        close_approach_date_full: '2036-Apr-13 06:17',
        epoch_date_close_approach: 2084768220000,
        relative_velocity: {
          kilometers_per_second: '7.13',
          kilometers_per_hour: '25668',
          miles_per_hour: '15950',
        },
        miss_distance: {
          astronomical: '0.093',
          lunar: '36.1',
          kilometers: '13900000',
          miles: '8640000',
        },
        orbiting_body: 'Earth',
      },
    ],
    orbital_data: {
      orbit_id: '220',
      orbit_determination_date: '2024-06-25 10:48:08',
      first_observation_date: '2004-03-15',
      last_observation_date: '2022-04-09',
      data_arc_in_days: '6599',
      observations_used: '7370',
      orbit_uncertainty: '0',
      minimum_orbit_intersection: '0.000361',
      jupiter_tisserand_invariant: '6.466',
      epoch_osculation: '2461000.5',
      eccentricity: '0.191',
      semi_major_axis: '0.922',
      inclination: '3.34',
      ascending_node_longitude: '204',
      orbital_period: '324',
      perihelion_distance: '0.746',
      perihelion_argument: '127',
      aphelion_distance: '1.1',
      perihelion_time: '2461042.918',
      mean_anomaly: '313',
      mean_motion: '1.11',
      equinox: 'J2000',
      orbit_class: {
        orbit_class_type: 'ATE',
        orbit_class_description: 'Near-Earth asteroid with semi-major axis < 1 AU',
        orbit_class_range: 'a < 1.0 AU',
      },
    },
    links: {
      self: 'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=99942',
    },
    nasa_jpl_url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=99942',
    is_sentry_object: true,
  },
];

export function fallbackNeos(size = FALLBACK_NEOS.length): NeoItem[] {
  return FALLBACK_NEOS.slice(0, Math.max(0, size));
}

export function buildFallbackBrowse(size = FALLBACK_NEOS.length): NeoBrowse {
  const neos = fallbackNeos(size);
  return {
    links: {
      self: 'fallback://neo/browse',
      fallback: 'sample',
    },
    page: {
      size: neos.length,
      total_elements: FALLBACK_NEOS.length,
      total_pages: 1,
      number: 0,
    },
    near_earth_objects: neos,
  };
}
