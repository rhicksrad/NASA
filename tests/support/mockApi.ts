/**
 * Offline stand-ins for everything the site fetches at runtime.
 *
 * The site talks to one Cloudflare Worker plus a handful of image hosts. These
 * fixtures let the smoke tests render every page deterministically without
 * touching the network, so they run the same in CI, locally, and in sandboxes.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page, Route } from '@playwright/test';

const require = createRequire(import.meta.url);

export const WORKER_HOST = 'lively-haze-4b2c.hicksrch.workers.dev';

const CORS = { 'access-control-allow-origin': '*' };

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
}

function text(route: Route, body: string, contentType = 'text/markdown') {
  return route.fulfill({ status: 200, headers: CORS, contentType, body });
}

/** A deterministic gradient "photo" so image slots render with real dimensions. */
function placeholderImage(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512" viewBox="0 0 1024 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 60% 28%)"/>
      <stop offset="1" stop-color="hsl(${(hue + 70) % 360} 65% 12%)"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="512" fill="url(#g)"/>
  <circle cx="${200 + (hash % 600)}" cy="${120 + (hash % 250)}" r="90" fill="hsl(${(hue + 180) % 360} 70% 70% / 0.35)"/>
</svg>`;
}

const IMAGE_TITLES = [
  'Earthrise over the lunar horizon',
  'Saturn V on the pad',
  'Station cupola at sunrise',
  'Webb deep field',
  'Hubble servicing mission',
  'Curiosity at Gale crater',
  'Perseverance sample tube',
  'Lunar Reconnaissance mosaic',
  'Spacewalk outside Quest airlock',
  'Orion capsule recovery',
  'Mars panorama at Jezero',
  'Solar Dynamics Observatory flare',
];

function imageSearch(url: URL) {
  const q = url.searchParams.get('q') ?? 'nasa';
  const page = Number(url.searchParams.get('page') ?? '1');
  const items = IMAGE_TITLES.map((title, index) => {
    const id = `MOCK-${q.replace(/\W+/g, '-').slice(0, 24)}-${page}-${index}`;
    return {
      href: `https://images-assets.nasa.gov/image/${id}/collection.json`,
      data: [
        {
          nasa_id: id,
          title: `${title} (${q})`,
          description: `Fixture description for ${title.toLowerCase()}.`,
          date_created: `20${10 + index}-0${1 + (index % 9)}-15T12:00:00Z`,
          photographer: 'NASA/Fixture',
          media_type: 'image',
          keywords: ['fixture', q],
        },
      ],
      links: [{ href: `https://images-assets.nasa.gov/image/${id}/${id}~thumb.jpg`, rel: 'preview', render: 'image' }],
    };
  });
  return {
    collection: {
      items,
      metadata: { total_hits: 240 },
      links: [{ rel: 'next', href: 'next' }],
    },
  };
}

function imageAsset(id: string) {
  const base = `http://images-assets.nasa.gov/image/${id}/${id}`;
  return {
    collection: {
      items: [
        { href: `${base}~orig.jpg` },
        { href: `${base}~large.jpg` },
        { href: `${base}~medium.jpg` },
        { href: `${base}~small.jpg` },
        { href: `${base}~thumb.jpg` },
        { href: `${base.replace(id + '/' + id, id + '/metadata')}.json` },
      ],
    },
  };
}

function neoBrowse(url: URL) {
  const page = Number(url.searchParams.get('page') ?? '0');
  const size = Number(url.searchParams.get('size') ?? '20');
  const near_earth_objects = Array.from({ length: Math.min(size, 20) }, (_, index) => {
    const n = page * size + index;
    const a = 1.1 + (n % 7) * 0.22;
    const e = 0.12 + (n % 5) * 0.09;
    return {
      id: String(2000433 + n),
      neo_reference_id: String(2000433 + n),
      name: `${433 + n} Fixture-${n} (19${50 + (n % 40)} AB)`,
      designation: String(433 + n),
      nasa_jpl_url: 'https://ssd.jpl.nasa.gov/',
      absolute_magnitude_h: 14 + (n % 9) * 0.7,
      estimated_diameter: {
        kilometers: { estimated_diameter_min: 0.4 + n * 0.01, estimated_diameter_max: 0.9 + n * 0.02 },
        meters: { estimated_diameter_min: 400, estimated_diameter_max: 900 },
        miles: { estimated_diameter_min: 0.25, estimated_diameter_max: 0.56 },
        feet: { estimated_diameter_min: 1300, estimated_diameter_max: 2950 },
      },
      is_potentially_hazardous_asteroid: n % 3 === 0,
      close_approach_data: [
        {
          close_approach_date: '2027-03-14',
          close_approach_date_full: '2027-Mar-14 08:30',
          epoch_date_close_approach: Date.UTC(2027, 2, 14, 8, 30),
          relative_velocity: { kilometers_per_second: '12.4', kilometers_per_hour: '44640', miles_per_hour: '27738' },
          miss_distance: { astronomical: '0.12', lunar: '46.7', kilometers: '17951745', miles: '11154700' },
          orbiting_body: 'Earth',
        },
      ],
      orbital_data: {
        orbit_id: '1',
        epoch_osculation: '2461000.5',
        eccentricity: String(e),
        semi_major_axis: String(a),
        inclination: String(4 + (n % 11) * 2.3),
        ascending_node_longitude: String((n * 47) % 360),
        orbital_period: String(365.25 * Math.pow(a, 1.5)),
        perihelion_distance: String(a * (1 - e)),
        perihelion_argument: String((n * 83) % 360),
        aphelion_distance: String(a * (1 + e)),
        perihelion_time: '2460900.5',
        mean_anomaly: String((n * 29) % 360),
        mean_motion: String(0.9856 / Math.pow(a, 1.5)),
        equinox: 'J2000',
        orbit_class: { orbit_class_type: 'APO', orbit_class_description: 'Apollo', orbit_class_range: 'a > 1.0 AU' },
      },
      is_sentry_object: false,
    };
  });
  return {
    links: {},
    page: { size, total_elements: 60, total_pages: 3, number: page },
    near_earth_objects,
  };
}

// Mean circular orbits are plenty for a screenshot: [semi-major axis AU, period days, phase deg].
const PLANETS: Record<string, [number, number, number]> = {
  '199': [0.387, 87.97, 30],
  '299': [0.723, 224.7, 110],
  '399': [1.0, 365.25, 200],
  '499': [1.524, 686.98, 290],
  '599': [5.203, 4332.6, 40],
  '699': [9.537, 10759, 130],
  '799': [19.19, 30687, 220],
  '899': [30.07, 60190, 310],
  '999': [39.48, 90560, 75],
};

function horizons(url: URL) {
  const command = (url.searchParams.get('COMMAND') ?? '').replace(/'/g, '');
  const tlist = (url.searchParams.get('TLIST') ?? '').replace(/'/g, '');
  const when = Date.parse(`${tlist.replace(' ', 'T')}Z`);
  const days = (Number.isFinite(when) ? when : Date.UTC(2026, 0, 1)) / 86_400_000;
  const [a, period, phase] = PLANETS[command] ?? [2.5, 1400, 0];
  const angle = ((phase + (days / period) * 360) * Math.PI) / 180;
  const speed = (2 * Math.PI * a) / period;
  const fmt = (value: number) => value.toExponential(15).toUpperCase();
  const result = [
    '$$SOE',
    `2461000.500000000 = A.D. ${tlist} TDB`,
    ` X =${fmt(a * Math.cos(angle))} Y =${fmt(a * Math.sin(angle))} Z =${fmt(0)}`,
    ` VX=${fmt(-speed * Math.sin(angle))} VY=${fmt(speed * Math.cos(angle))} VZ=${fmt(0)}`,
    '$$EOE',
  ].join('\n');
  return { signature: { source: 'fixture', version: '1.2' }, result };
}

function sbdb(url: URL) {
  const sstr = url.searchParams.get('sstr') ?? 'fixture';
  return {
    object: {
      fullname: `${sstr} (fixture)`,
      shortname: sstr,
      des: sstr,
      kind: 'an',
      neo: true,
      pha: false,
      orbit_class: { code: 'APO', name: 'Apollo' },
    },
    orbit: {
      epoch: '2461000.5',
      elements: [
        { name: 'e', label: 'e', value: '0.2228' },
        { name: 'a', label: 'a', value: '1.458' },
        { name: 'q', label: 'q', value: '1.133' },
        { name: 'i', label: 'i', value: '10.83' },
        { name: 'om', label: 'node', value: '304.3' },
        { name: 'w', label: 'peri', value: '178.9' },
        { name: 'ma', label: 'M', value: '110.8' },
        { name: 'tp', label: 'tp', value: '2460801.2' },
        { name: 'per', label: 'period', value: '643.1' },
        { name: 'n', label: 'n', value: '0.5598' },
      ],
    },
    phys_par: [
      { name: 'H', value: '10.4' },
      { name: 'diameter', value: '16.84' },
    ],
  };
}

const TLES = [
  {
    satelliteId: 25544,
    name: 'ISS (ZARYA)',
    date: '2026-01-01T12:00:00+00:00',
    line1: '1 25544U 98067A   26001.50000000  .00016717  00000-0  10270-3 0  9005',
    line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49815350  1234',
  },
  {
    satelliteId: 20580,
    name: 'HST',
    date: '2026-01-01T12:00:00+00:00',
    line1: '1 20580U 90037B   26001.50000000  .00001000  00000-0  50000-4 0  9991',
    line2: '2 20580  28.4700 100.0000 0002500  90.0000 270.0000 15.09000000  1230',
  },
  {
    satelliteId: 43013,
    name: 'NOAA 20',
    date: '2026-01-01T12:00:00+00:00',
    line1: '1 43013U 17073A   26001.50000000  .00000100  00000-0  60000-4 0  9992',
    line2: '2 43013  98.7400  60.0000 0001000  80.0000 280.0000 14.19500000  1237',
  },
];

const STORM_MD = `# CME 2024-05-10T16:36:00-CME-001

> Fixture report generated for offline tests.

## Summary
- **Start:** 2024-05-10T16:36Z
- **Source:** N15W05, AR 13664
- **Catalog:** https://kauai.ccmc.gsfc.nasa.gov/DONKI/

## Analyses
- Speed **1250 km/s**, half-angle 45°
- See [DONKI entry](https://kauai.ccmc.gsfc.nasa.gov/DONKI/view/CME/1/1)
`;

const STORM_JSON = {
  cme: { activityID: '2024-05-10T16:36:00-CME-001', sourceLocation: 'N15W05', activeRegionNum: 13664 },
  analyses: [{ speed: 1250, halfAngle: 45 }],
  enlil: [
    {
      kp_90: 8,
      estimatedShockArrivals: [],
      impactList: [{ location: 'STEREO A', arrivalTime: '2024-05-12T02:00Z' }],
    },
    { kp_90: 8, estimatedShockArrivals: [{ location: 'Earth', arrivalTime: '2024-05-12T06:00Z' }] },
  ],
  ips: [{ location: 'Earth', eventTime: '2024-05-12T08:55Z' }],
  gst: [
    {
      startTime: '2024-05-12T12:00Z',
      allKpIndex: [
        { observedTime: '2024-05-12T12:00Z', kpIndex: 7 },
        { observedTime: '2024-05-12T15:00Z', kpIndex: 8.33 },
        { observedTime: '2024-05-12T18:00Z', kpIndex: 9 },
        { observedTime: '2024-05-12T21:00Z', kpIndex: 7.67 },
      ],
    },
  ],
};

const EONET_CATEGORIES = {
  categories: [
    { id: 'wildfires', title: 'Wildfires' },
    { id: 'severeStorms', title: 'Severe Storms' },
    { id: 'volcanoes', title: 'Volcanoes' },
    { id: 'seaLakeIce', title: 'Sea and Lake Ice' },
  ],
};

const EONET_EVENTS = {
  events: [
    {
      id: 'EONET_1001',
      title: 'Wildfire - Northern California <test>',
      categories: [{ id: 'wildfires', title: 'Wildfires' }],
      geometry: [{ date: '2026-01-04T00:00:00Z', type: 'Point', coordinates: [-121.6, 40.1] }],
    },
    {
      id: 'EONET_1002',
      title: 'Tropical Storm Fixture',
      categories: [{ id: 'severeStorms', title: 'Severe Storms' }],
      geometry: [
        { date: '2026-01-02T00:00:00Z', type: 'Point', coordinates: [130.2, 14.5] },
        { date: '2026-01-03T00:00:00Z', type: 'Point', coordinates: [128.9, 16.1] },
      ],
    },
    {
      id: 'EONET_1003',
      title: 'Etna Volcano, Italy',
      categories: [{ id: 'volcanoes', title: 'Volcanoes' }],
      geometry: [{ date: '2026-01-01T00:00:00Z', type: 'Point', coordinates: [14.99, 37.75] }],
    },
    {
      id: 'EONET_1004',
      title: 'Iceberg A-Fixture',
      categories: [{ id: 'seaLakeIce', title: 'Sea and Lake Ice' }],
      geometry: [{ date: '2025-12-30T00:00:00Z', type: 'Point', coordinates: [-45.3, -61.2] }],
    },
  ],
};

const EVENT_MD = `# Wildfire - Northern California

- **Category:** Wildfires
- **Last seen:** 2026-01-04
- Source: [InciWeb](https://inciweb.wildfire.gov/)
`;

const EXO_ROWS = [
  ['Kepler-22 b', 'Kepler-22', 2.1, 9.1, 279, 289.86, 194.6, 289.2, 47.9, 2011],
  ['TRAPPIST-1 e', 'TRAPPIST-1', 0.92, 0.69, 250, 6.1, 12.43, 346.6, -5.04, 2017],
  ['55 Cnc e', '55 Cnc', 1.88, 7.99, 1958, 0.74, 12.59, 133.1, 28.33, 2004],
  ['HD 209458 b', 'HD 209458', 15.2, 232, 1449, 3.52, 48.3, 330.8, 18.88, 1999],
  ['K2-18 b', 'K2-18', 2.61, 8.63, 255, 32.94, 38.03, 172.6, 7.59, 2015],
  ['GJ 1214 b', 'GJ 1214', 2.74, 8.17, 596, 1.58, 14.64, 258.8, 4.96, 2009],
  ['WASP-12 b', 'WASP-12', 21.7, 467, 2601, 1.09, 427.2, 97.6, 29.67, 2008],
  ['Kepler-1649 c', 'Kepler-1649', 1.06, null, 234, 19.54, 92.2, 292.5, 41.83, 2020],
].map(([pl_name, hostname, rade, masse, eqt, period, distance_pc, ra, dec, disc_year]) => ({
  pl_name,
  hostname,
  rade,
  masse,
  eqt,
  period,
  distance_pc,
  ra,
  dec,
  disc_year,
}));

const EPIC_ITEMS = Array.from({ length: 6 }, (_, index) => ({
  identifier: `2026010100${index}000`,
  caption: 'This image was taken by NASA\'s EPIC camera onboard the NOAA DSCOVR spacecraft',
  image: `epic_1b_2026010100${index}000`,
  date: `2026-01-01 0${index}:13:42`,
  centroid_coordinates: { lat: 4.2 - index, lon: 150 - index * 30 },
}));

function handleWorker(route: Route, url: URL) {
  const path = url.pathname;
  if (path === '/images/search') return json(route, imageSearch(url));
  if (path.startsWith('/images/asset/')) return json(route, imageAsset(decodeURIComponent(path.split('/').pop() ?? 'x')));
  if (path === '/neo/browse') return json(route, neoBrowse(url));
  if (path === '/horizons') return json(route, horizons(url));
  if (path === '/sbdb' || path === '/sbdb/object') return json(route, sbdb(url));
  if (path === '/sbdb/search' || path === '/sbdb/suggest') return json(route, { items: [], list: [] });
  if (path === '/tle/search') return json(route, { member: TLES });
  if (path.startsWith('/tle/')) {
    const id = Number(path.split('/').pop());
    const match = TLES.find((entry) => entry.satelliteId === id);
    return match ? json(route, match) : json(route, { message: 'not found' }, 404);
  }
  if (path === '/storm/find') {
    return json(route, {
      items: [
        { activityID: '2024-05-10T16:36:00-CME-001', startTime: '2024-05-10T16:36Z', note: 'Halo CME from AR 13664' },
        { activityID: '2024-05-11T01:36:00-CME-001', startTime: '2024-05-11T01:36Z', note: 'Second halo CME' },
      ],
    });
  }
  if (/^\/storm\/.+\.md$/.test(path)) return text(route, STORM_MD);
  if (/^\/storm\/.+\.json$/.test(path)) return json(route, STORM_JSON);
  if (/^\/event\/.+\.md$/.test(path)) return text(route, EVENT_MD);
  if (path === '/eonet/categories') return json(route, EONET_CATEGORIES);
  if (path === '/eonet/events') return json(route, EONET_EVENTS);
  if (path === '/exo/tap' || path === '/exoplanet/tap') return json(route, EXO_ROWS);
  if (path.startsWith('/epic/')) return json(route, EPIC_ITEMS);
  return json(route, { ok: false, message: 'Not Found', path }, 404);
}

export interface MockApi {
  /** Every request that left the page for a host other than the dev server. */
  external: string[];
  /** Requests that the fixtures did not recognise. */
  unhandled: string[];
}

export async function installMockApi(page: Page): Promise<MockApi> {
  const log: MockApi = { external: [], unhandled: [] };

  await page.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'data:' || url.protocol === 'blob:') {
      return route.continue();
    }
    log.external.push(request.url());

    if (url.hostname === WORKER_HOST) return handleWorker(route, url);
    if (url.hostname === 'epic.gsfc.nasa.gov' && url.pathname.startsWith('/api/')) return json(route, EPIC_ITEMS);
    if (url.hostname === 'unpkg.com' && url.pathname.includes('leaflet')) {
      const file = url.pathname.endsWith('.css') ? 'leaflet/dist/leaflet.css' : 'leaflet/dist/leaflet.js';
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: file.endsWith('.css') ? 'text/css' : 'application/javascript',
        body: readFileSync(require.resolve(file), 'utf8'),
      });
    }
    if (request.resourceType() === 'image' || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url.pathname)) {
      return route.fulfill({
        status: 200,
        headers: CORS,
        contentType: 'image/svg+xml',
        body: placeholderImage(url.pathname),
      });
    }
    log.unhandled.push(request.url());
    return route.abort();
  });

  return log;
}
