/** Live ISS tile: a world map with the day/night line, the ground track and a ticking position. */
import { getTLE } from '../../../api/tle';
import { svgEl } from '../../../lib/dom';
import { formatInt, formatLatitude, formatLongitude } from './format';

const ISS_ID = 25544;
const TRACK_MINUTES = 92;
const TRACK_STEP_SECONDS = 60;
const DEG = Math.PI / 180;

/** Where the Sun is directly overhead, from the Astronomical Almanac's low-precision formula. */
function subsolarPoint(date: Date, gmstRadians: number): { latitude: number; longitude: number } {
  const days = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86_400_000;
  const meanAnomaly = (357.528 + 0.9856003 * days) * DEG;
  const eclipticLongitude =
    (280.46 + 0.9856474 * days + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * days) * DEG;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const longitude = ((((rightAscension - gmstRadians) / DEG + 540) % 360) + 360) % 360 - 180;
  return { latitude: declination / DEG, longitude };
}

/** SVG path covering the night side of an equirectangular 360x180 map. */
function nightPath(sun: { latitude: number; longitude: number }): string {
  const declination = (Math.abs(sun.latitude) < 0.1 ? 0.1 * Math.sign(sun.latitude || 1) : sun.latitude) * DEG;
  const points: string[] = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const latitude = Math.atan(-Math.cos((lon - sun.longitude) * DEG) / Math.tan(declination)) / DEG;
    points.push(`${lon + 180},${(90 - latitude).toFixed(1)}`);
  }
  // The pole tilted away from the Sun is the dark one.
  const darkEdge = declination > 0 ? 180 : 0;
  return `M${points.join('L')}L360,${darkEdge}L0,${darkEdge}Z`;
}

/** Polyline path that lifts the pen where the track wraps around the antimeridian. */
function trackPath(points: Array<[number, number]>): string {
  let path = '';
  let previousLon: number | null = null;
  for (const [lon, lat] of points) {
    const wrapped = previousLon !== null && Math.abs(lon - previousLon) > 180;
    path += `${previousLon === null || wrapped ? 'M' : 'L'}${(lon + 180).toFixed(1)},${(90 - lat).toFixed(1)}`;
    previousLon = lon;
  }
  return path;
}

/**
 * Fills the ISS tile and keeps it ticking once a second.
 * The orbit maths and the land outline load on demand so the rest of the home page is not held up.
 */
export async function mountIssTile(tile: HTMLElement, signal: AbortSignal): Promise<void> {
  const mapHost = tile.querySelector<HTMLElement>('#iss-map');
  const stat = (name: string) => tile.querySelector<HTMLElement>(`[data-stat="${name}"]`);
  if (!mapHost) return;

  const [tle, sgp4, { WORLD_LAND_PATH }] = await Promise.all([
    getTLE(ISS_ID, signal),
    import('../../sat3d/sgp4'),
    import('../../../assets/worldLand'),
  ]);
  if (signal.aborted) return;
  const satrec = sgp4.tleToSatrec(tle.line1, tle.line2);

  const svg = svgEl('svg', { viewBox: '0 0 360 180', preserveAspectRatio: 'xMidYMid meet' });
  const night = svgEl('path', { class: 'iss-map__night' });
  const past = svgEl('path', { class: 'iss-map__track iss-map__track--past' });
  const ahead = svgEl('path', { class: 'iss-map__track' });
  const pulse = svgEl('circle', { class: 'iss-map__pulse', r: 3 });
  const dot = svgEl('circle', { class: 'iss-map__dot', r: 2.2 });
  svg.append(svgEl('path', { class: 'iss-map__land', d: WORLD_LAND_PATH }), night, past, ahead, pulse, dot);
  mapHost.replaceChildren(svg);

  const groundPoint = (date: Date) => {
    const state = sgp4.propEciKm(satrec, date);
    if (!state) return null;
    const geo = sgp4.eciToLngLatAlt(date, state.position);
    return { ...geo, longitude: sgp4.normalizeLongitude(geo.longitude), speedKmS: Math.hypot(...state.velocity) };
  };

  const sampleTrack = (fromMs: number, toMs: number) => {
    const points: Array<[number, number]> = [];
    for (let time = fromMs; time <= toMs; time += TRACK_STEP_SECONDS * 1000) {
      const point = groundPoint(new Date(time));
      if (point) points.push([point.longitude, point.latitude]);
    }
    return trackPath(points);
  };

  let lastSlowUpdate = 0;
  const tick = () => {
    const now = new Date();
    const here = groundPoint(now);
    if (!here) return;
    const x = here.longitude + 180;
    const y = 90 - here.latitude;
    for (const marker of [dot, pulse]) {
      marker.setAttribute('cx', x.toFixed(2));
      marker.setAttribute('cy', y.toFixed(2));
    }
    const set = (name: string, value: string) => {
      const element = stat(name);
      if (element) element.textContent = value;
    };
    set('lat', formatLatitude(here.latitude));
    set('lon', formatLongitude(here.longitude));
    set('alt', `${formatInt(here.altitude)} km`);
    set('speed', `${formatInt(here.speedKmS * 3600)} km/h`);

    // The track and the terminator move slowly; redraw them once a minute.
    if (now.getTime() - lastSlowUpdate > 60_000) {
      lastSlowUpdate = now.getTime();
      const span = TRACK_MINUTES * 60_000;
      past.setAttribute('d', sampleTrack(now.getTime() - span / 2, now.getTime()));
      ahead.setAttribute('d', sampleTrack(now.getTime(), now.getTime() + span));
      night.setAttribute('d', nightPath(subsolarPoint(now, sgp4.gmstFromDate(now))));
    }
  };

  tick();
  tile.classList.add('is-ready');
  const timer = window.setInterval(tick, 1000);
  signal.addEventListener('abort', () => window.clearInterval(timer), { once: true });
}
