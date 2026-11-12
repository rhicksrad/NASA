/** The "happening right now" tiles: asteroid flybys, natural events and solar eruptions. */
import { findCmes } from '../../../api/donki';
import { fetchEonetEvents } from '../../../api/eonet';
import { getNeoFeed, type NeoItem } from '../../../api/neo';
import { svgEl } from '../../../lib/dom';
import { describeSize, formatAgo, formatInt, isoDay } from './format';

const DAY_MS = 86_400_000;

interface TileParts {
  value: HTMLElement;
  viz: HTMLElement;
  detail: HTMLElement;
}

function partsOf(tile: HTMLElement): TileParts | null {
  const value = tile.querySelector<HTMLElement>('[data-value]');
  const viz = tile.querySelector<HTMLElement>('[data-viz]');
  const detail = tile.querySelector<HTMLElement>('[data-detail]');
  return value && viz && detail ? { value, viz, detail } : null;
}

/** Runs a tile loader and turns any failure into a quiet "unavailable" state. */
async function fillTile(
  tile: HTMLElement | null,
  signal: AbortSignal,
  load: (tile: HTMLAnchorElement, parts: TileParts) => Promise<void>,
): Promise<void> {
  const parts = tile && partsOf(tile);
  if (!tile || !parts) return;
  try {
    await load(tile as HTMLAnchorElement, parts);
    if (!signal.aborted) tile.classList.add('is-ready');
  } catch {
    if (signal.aborted) return;
    parts.value.textContent = '–';
    parts.detail.textContent = 'This feed is not answering right now. The explorer may still load.';
    tile.classList.add('is-unavailable');
  }
}

/* ---------- Asteroids ---------- */

interface Flyby {
  name: string;
  lunarDistances: number;
  diameterM: number;
  speedKmS: number;
  hazardous: boolean;
}

function toFlyby(neo: NeoItem): Flyby | null {
  const approach = neo.close_approach_data?.[0];
  const lunarDistances = Number(approach?.miss_distance?.lunar);
  if (!approach || !Number.isFinite(lunarDistances)) return null;
  const size = neo.estimated_diameter?.meters;
  return {
    name: neo.name.replace(/^\((.*)\)$/, '$1'),
    lunarDistances,
    diameterM: size ? (size.estimated_diameter_min + size.estimated_diameter_max) / 2 : NaN,
    speedKmS: Number(approach.relative_velocity?.kilometers_per_second),
    hazardous: neo.is_potentially_hazardous_asteroid,
  };
}

/** Earth on the left, the Moon one notch along, and every flyby placed by distance (log scale). */
function flybyStrip(flybys: Flyby[]): SVGSVGElement {
  const WIDTH = 300;
  const MIN_LD = 0.05;
  const MAX_LD = 250;
  const xFor = (ld: number) => {
    const clamped = Math.min(MAX_LD, Math.max(MIN_LD, ld));
    return 22 + ((Math.log10(clamped) - Math.log10(MIN_LD)) / (Math.log10(MAX_LD) - Math.log10(MIN_LD))) * (WIDTH - 30);
  };
  const svg = svgEl('svg', { viewBox: `0 0 ${WIDTH} 46`, role: 'img', 'aria-label': 'Today’s flybys by distance from Earth' });
  svg.append(
    svgEl('line', { class: 'strip__axis', x1: 8, y1: 20, x2: WIDTH - 4, y2: 20 }),
    svgEl('circle', { class: 'strip__earth', cx: 8, cy: 20, r: 6 }),
    svgEl('line', { class: 'strip__tick', x1: xFor(1), y1: 12, x2: xFor(1), y2: 28 }),
    svgEl('text', { class: 'strip__label', x: 2, y: 42 }, 'Earth'),
    svgEl('text', { class: 'strip__label', x: xFor(1), y: 42, 'text-anchor': 'middle' }, 'Moon'),
    svgEl('text', { class: 'strip__label', x: xFor(100), y: 42, 'text-anchor': 'middle' }, '100 × Moon'),
  );
  for (const flyby of [...flybys].sort((a, b) => b.lunarDistances - a.lunarDistances)) {
    const radius = Math.min(5, Math.max(1.8, Math.log10(Math.max(flyby.diameterM, 2)) * 1.6));
    const dot = svgEl('circle', {
      class: flyby.hazardous ? 'strip__rock strip__rock--hazard' : 'strip__rock',
      cx: xFor(flyby.lunarDistances).toFixed(1),
      cy: 20,
      r: radius.toFixed(1),
    });
    dot.append(svgEl('title', {}, `${flyby.name}: ${flyby.lunarDistances.toFixed(1)} lunar distances`));
    svg.append(dot);
  }
  return svg;
}

async function loadAsteroids(_tile: HTMLAnchorElement, parts: TileParts, signal: AbortSignal): Promise<void> {
  const today = isoDay(new Date());
  const feed = await getNeoFeed(today, today, signal);
  const flybys = (feed.near_earth_objects?.[today] ?? Object.values(feed.near_earth_objects ?? {}).flat())
    .map(toFlyby)
    .filter((flyby): flyby is Flyby => flyby !== null);
  parts.value.textContent = formatInt(flybys.length);
  if (!flybys.length) {
    parts.detail.textContent = 'No catalogued close approaches today.';
    return;
  }
  const closest = flybys.reduce((best, flyby) => (flyby.lunarDistances < best.lunarDistances ? flyby : best));
  parts.viz.replaceChildren(flybyStrip(flybys));
  const size = Number.isFinite(closest.diameterM) ? `, about ${describeSize(closest.diameterM)}` : '';
  const distance =
    closest.lunarDistances < 1
      ? `inside the Moon's orbit (${closest.lunarDistances.toFixed(2)}× its distance)`
      : `${closest.lunarDistances.toFixed(1)}× the Moon's distance`;
  const speed = Number.isFinite(closest.speedKmS) ? ` at ${formatInt(closest.speedKmS * 3600)} km/h` : '';
  parts.detail.textContent = `Closest is ${closest.name}${size}, passing ${distance}${speed}.`;
}

/* ---------- Natural events ---------- */

async function loadEvents(_tile: HTMLAnchorElement, parts: TileParts, signal: AbortSignal): Promise<void> {
  const now = new Date();
  const events = await fetchEonetEvents(
    { status: 'open', start: isoDay(new Date(now.getTime() - 30 * DAY_MS)), end: isoDay(now) },
    signal,
  );
  parts.value.textContent = formatInt(events.length);
  if (!events.length) {
    parts.detail.textContent = 'Nothing new reported in the last 30 days.';
    return;
  }

  const counts = new Map<string, number>();
  for (const event of events) {
    const category = event.categories?.[0]?.title ?? 'Other';
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const breakdown = ranked.map(([title, count]) => `${title} (${count})`).join(', ');
  const latest = events[0]?.title?.replace(/[.\s]+$/, '');
  parts.detail.textContent = `${breakdown}.${latest ? ` Most recent: ${latest}.` : ''}`;
}

/* ---------- Solar eruptions ---------- */

async function loadEruptions(tile: HTMLAnchorElement, parts: TileParts, signal: AbortSignal): Promise<void> {
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, index) => isoDay(new Date(now.getTime() - (6 - index) * DAY_MS)));
  const eruptions = await findCmes(days[0], days[6], signal);
  parts.value.textContent = formatInt(eruptions.length);

  const perDay = days.map((day) => eruptions.filter((cme) => (cme.startTime ?? cme.activityID).startsWith(day)).length);
  const peak = Math.max(1, ...perDay);
  const bars = document.createElement('div');
  bars.className = 'day-bars';
  perDay.forEach((count, index) => {
    const bar = document.createElement('span');
    bar.style.height = `${Math.max(6, (count / peak) * 100)}%`;
    bar.classList.toggle('is-empty', count === 0);
    bar.title = `${days[index]}: ${count}`;
    bars.append(bar);
  });
  // A week with one eruption or none has no shape worth drawing.
  if (eruptions.length > 1) parts.viz.replaceChildren(bars);
  else parts.viz.replaceChildren();

  const latest = eruptions
    .map((cme) => ({ cme, time: new Date(cme.startTime ?? '') }))
    .filter(({ time }) => !Number.isNaN(time.getTime()))
    .sort((a, b) => b.time.getTime() - a.time.getTime())[0];
  if (!latest) {
    parts.detail.textContent = 'A quiet week on the Sun so far.';
    return;
  }
  tile.href = `storm.html?id=${encodeURIComponent(latest.cme.activityID)}`;
  parts.detail.textContent = `The most recent left the Sun ${formatAgo(latest.time, now)}. Its report shows where it is headed.`;
}

export function mountLiveTiles(host: HTMLElement, signal: AbortSignal): void {
  const tile = (id: string) => host.querySelector<HTMLElement>(`#${id}`);
  void fillTile(tile('tile-neo'), signal, (el, parts) => loadAsteroids(el, parts, signal));
  void fillTile(tile('tile-events'), signal, (el, parts) => loadEvents(el, parts, signal));
  void fillTile(tile('tile-cme'), signal, (el, parts) => loadEruptions(el, parts, signal));
}
