/** Earth events: EONET's natural events on a map, with a list and a detail pane built from each record. */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// After Leaflet's stylesheet so the site's overrides win.
import '../../styles/events.css';
import { fetchEonetCategories, fetchEonetEvents, type EonetEvent, type EonetGeometry } from '../../api/eonet';
import { isAbortError } from '../../api/worker';
import { WORLD_LAND_PATH } from '../../assets/worldLand';
import { byId, stateArt, svgEl } from '../../lib/dom';
import { initSiteNav } from '../../shell/nav';

initSiteNav();

const categorySelect = byId<HTMLSelectElement>('category');
const statusSelect = byId<HTMLSelectElement>('status');
const startInput = byId<HTMLInputElement>('start');
const endInput = byId<HTMLInputElement>('end');
const filtersForm = byId<HTMLFormElement>('filters');
const submitButton = filtersForm.querySelector<HTMLButtonElement>('button[type="submit"]');
const listEl = byId<HTMLUListElement>('list');
const legendEl = byId('legend');
const detailEl = byId('detail');
const detailTitle = byId('detailTitle');
const countEl = byId('count');

/** Marker colours, drawn from the illustration palette first and neighbours of it after. */
const CATEGORY_COLORS: Record<string, string> = {
  wildfires: '#ff4a2b',
  severeStorms: '#6aa5f8',
  volcanoes: '#d9a441',
  seaLakeIce: '#f0ece2',
  floods: '#4fc3c8',
  dustHaze: '#c9b28a',
  landslides: '#b0764a',
  snow: '#c6d3e6',
  waterColor: '#6fbf9b',
  tempExtremes: '#f08a9b',
  drought: '#e0c26a',
  earthquakes: '#b79cf2',
  manmade: '#9aa0a8',
};
const DEFAULT_COLOR = '#9aa0a8';
const colorFor = (categoryId: string | undefined) => CATEGORY_COLORS[categoryId ?? ''] ?? DEFAULT_COLOR;

const MARKER_STYLE = { radius: 5.5, weight: 1.5, color: '#0b0c10', opacity: 1, fillOpacity: 1 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isoDay(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.append(...children);
  return element;
}

function formatWhen(iso: string | undefined | null, withYear = false): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${withYear ? ` ${date.getUTCFullYear()}` : ''}`;
  const clock = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  return clock === '00:00' ? day : `${day}, ${clock} UTC`;
}

function formatPosition([lat, lon]: L.LatLngTuple): string {
  const part = (value: number, positive: string, negative: string) =>
    `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;
  return `${part(lat, 'N', 'S')}, ${part(lon, 'E', 'W')}`;
}

/** EONET's unit codes, spelled the way a reader would say them. */
function unitName(unit: string | null | undefined): string {
  if (unit === 'kts') return 'knots';
  if (unit === 'NM^2') return 'sq nautical miles';
  return unit ?? '';
}

function formatMagnitude(geometry: EonetGeometry | undefined): string {
  const value = geometry?.magnitudeValue;
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${unitName(geometry?.magnitudeUnit)}`.trim();
}

const eventTitle = (event: EonetEvent) => event.title || event.id;
const categoryNames = (event: EonetEvent) =>
  event.categories?.map((category) => category.title).join(', ') || 'Uncategorised';
const lastSeen = (event: EonetEvent) => event.geometry?.at(-1)?.date ?? '';

/** A geometry's position as [lat, lon]; polygons collapse to their first vertex. */
function positionOf(geometry: EonetGeometry | undefined): L.LatLngTuple | null {
  let coords = geometry?.coordinates;
  while (Array.isArray(coords) && Array.isArray(coords[0])) coords = coords[0];
  if (!Array.isArray(coords)) return null;
  const [lon, lat] = coords.map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

const latestPosition = (event: EonetEvent) => positionOf(event.geometry?.at(-1));

// --- Map -------------------------------------------------------------------

/**
 * The base map is the site's own land outline rather than third-party tiles, so it matches the
 * rest of the pages and nothing is fetched from outside the Worker. Plate carrée lets the 360x180
 * outline sit on the map without reprojection.
 */
function landOverlay(): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 360 180', preserveAspectRatio: 'none', class: 'events-land' });
  for (let lon = 30; lon < 360; lon += 30) svg.append(svgEl('line', { x1: lon, x2: lon, y1: 0, y2: 180 }));
  for (let lat = 30; lat < 180; lat += 30) svg.append(svgEl('line', { x1: 0, x2: 360, y1: lat, y2: lat }));
  svg.append(svgEl('path', { d: WORLD_LAND_PATH }));
  return svg;
}

const WORLD_BOUNDS = L.latLngBounds([-90, -180], [90, 180]);
const map = L.map(byId('map'), {
  crs: L.CRS.EPSG4326,
  minZoom: 0,
  maxZoom: 6,
  zoomSnap: 0.25,
  maxBounds: WORLD_BOUNDS.pad(0.1),
  maxBoundsViscosity: 0.8,
  attributionControl: false,
});
L.svgOverlay(landOverlay(), WORLD_BOUNDS).addTo(map);
const trackLayer = L.layerGroup().addTo(map);
const markersLayer = L.layerGroup().addTo(map);
const markers = new Map<string, L.CircleMarker>();

function fitWorld(): void {
  map.fitBounds(WORLD_BOUNDS, { animate: false });
}
fitWorld();
new ResizeObserver(() => map.invalidateSize()).observe(map.getContainer());

let events: EonetEvent[] = [];
let activeEventId: string | null = null;

function renderMarkers(): void {
  markersLayer.clearLayers();
  trackLayer.clearLayers();
  markers.clear();

  const positions: L.LatLngTuple[] = [];
  const legend = new Map<string, { title: string; count: number }>();

  for (const event of events) {
    const category = event.categories?.[0];
    if (category) {
      const entry = legend.get(category.id) ?? { title: category.title, count: 0 };
      entry.count += 1;
      legend.set(category.id, entry);
    }
    const position = latestPosition(event);
    if (!position) continue;

    const marker = L.circleMarker(position, { ...MARKER_STYLE, fillColor: colorFor(category?.id) });
    // Leaflet tooltips take a node here, so the upstream title is never parsed as HTML.
    marker.bindTooltip(el('span', '', eventTitle(event)), { direction: 'top', offset: [0, -6], className: 'events-tip' });
    marker.on('click', () => selectEvent(event, { centerOnMap: false }));
    marker.addTo(markersLayer);

    markers.set(event.id, marker);
    positions.push(position);
  }

  if (positions.length > 1) map.fitBounds(L.latLngBounds(positions).pad(0.15), { maxZoom: 4, animate: false });
  else fitWorld();

  const entries = [...legend.entries()].sort((a, b) => b[1].count - a[1].count);
  legendEl.replaceChildren(
    ...entries.map(([id, { title, count }]) => {
      const swatch = el('span', 'swatch');
      swatch.style.background = colorFor(id);
      return el('span', 'legend__item', swatch, `${title} `, el('b', '', String(count)));
    }),
  );
}

function highlightActive(): void {
  for (const item of listEl.querySelectorAll<HTMLElement>('li[data-event-id]')) {
    item.classList.toggle('active', item.dataset.eventId === activeEventId);
  }
  for (const [id, marker] of markers) {
    const active = id === activeEventId;
    marker.setStyle({
      radius: active ? 9 : MARKER_STYLE.radius,
      weight: active ? 2.5 : MARKER_STYLE.weight,
      color: active ? '#f0ece2' : MARKER_STYLE.color,
    });
    if (active) marker.bringToFront();
  }
}

/** Draws the path of an event that has been reported from more than one place. */
function renderTrack(event: EonetEvent): L.LatLngTuple[] {
  trackLayer.clearLayers();
  const points = (event.geometry ?? []).map(positionOf).filter((point): point is L.LatLngTuple => point !== null);
  if (points.length < 2) return points;
  const color = colorFor(event.categories?.[0]?.id);
  L.polyline(points, { color, weight: 1.5, opacity: 0.9, dashArray: '2 5', interactive: false }).addTo(trackLayer);
  for (const point of points.slice(0, -1)) {
    L.circleMarker(point, { radius: 2.5, weight: 0, fillColor: color, fillOpacity: 0.9, interactive: false }).addTo(trackLayer);
  }
  return points;
}

// --- List and detail ---------------------------------------------------------

function listMessage(node: Node | string): void {
  listEl.replaceChildren(el('li', 'list__note', node));
}

function renderList(): void {
  if (!events.length) {
    listMessage(stateArt('empty', 'Nothing was recorded for those filters. Try a wider range of dates.'));
    return;
  }
  listEl.replaceChildren(
    ...events.map((event) => {
      const dot = el('span', 'swatch');
      dot.style.background = colorFor(event.categories?.[0]?.id);
      const magnitude = formatMagnitude(event.geometry?.at(-1));
      const meta = [categoryNames(event), formatWhen(lastSeen(event)), magnitude].filter(Boolean).join(' · ');

      const item = el('li', '', dot, el('span', 'list__title', eventTitle(event)), el('span', 'list__meta', meta));
      item.dataset.eventId = event.id;
      item.tabIndex = 0;
      item.addEventListener('click', () => selectEvent(event));
      item.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return;
        keyEvent.preventDefault();
        selectEvent(event);
      });
      return item;
    }),
  );
}

function resetDetail(): void {
  activeEventId = null;
  trackLayer.clearLayers();
  detailTitle.textContent = 'Pick an event';
  detailEl.replaceChildren(
    el('p', '', 'Choose a marker on the map or a line in the list to see where it is, how big it has grown and who reported it.'),
  );
}

/** Size or strength over time, for events reported with a magnitude at three or more moments. */
function magnitudeChart(geometry: EonetGeometry[]): HTMLElement | null {
  const readings = geometry
    .map((entry) => ({ t: new Date(entry.date ?? '').getTime(), value: entry.magnitudeValue }))
    .filter((entry): entry is { t: number; value: number } => Number.isFinite(entry.t) && typeof entry.value === 'number');
  if (readings.length < 3) return null;

  const width = 520;
  const height = 120;
  const pad = 6;
  const minT = readings[0].t;
  const maxT = readings[readings.length - 1].t;
  const maxV = Math.max(...readings.map((reading) => reading.value));
  if (maxT <= minT || maxV <= 0) return null;
  const x = (t: number) => pad + ((t - minT) / (maxT - minT)) * (width - pad * 2);
  const y = (value: number) => height - 18 - (value / maxV) * (height - 40);

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'events-spark', role: 'img' });
  const unit = unitName(geometry.at(-1)?.magnitudeUnit);
  svg.setAttribute('aria-label', `Reported size over time, peaking at ${maxV} ${unit}`);
  const line = readings.map((reading) => `${x(reading.t).toFixed(1)},${y(reading.value).toFixed(1)}`).join('L');
  const peak = readings.reduce((best, reading) => (reading.value > best.value ? reading : best));
  const peakX = x(peak.t);
  svg.append(
    svgEl('line', { x1: pad, x2: width - pad, y1: height - 18, y2: height - 18, class: 'events-spark__base' }),
    svgEl('path', { d: `M${line}`, class: 'events-spark__line' }),
    svgEl('circle', { cx: peakX, cy: y(peak.value), r: 3.5, class: 'events-spark__peak' }),
    svgEl(
      'text',
      { x: peakX + (peakX > width * 0.7 ? -8 : 8), y: y(peak.value) - 6, 'text-anchor': peakX > width * 0.7 ? 'end' : 'start', class: 'events-spark__label' },
      `${peak.value.toLocaleString('en-US')} ${unit}`,
    ),
    svgEl('text', { x: pad, y: height - 3, class: 'events-spark__tick' }, formatWhen(new Date(minT).toISOString()).split(',')[0]),
    svgEl(
      'text',
      { x: width - pad, y: height - 3, 'text-anchor': 'end', class: 'events-spark__tick' },
      formatWhen(new Date(maxT).toISOString()).split(',')[0],
    ),
  );
  return el('div', 'events-detail__chart', svg);
}

function renderDetail(event: EonetEvent): void {
  const geometry = event.geometry ?? [];
  const first = geometry[0];
  const last = geometry.at(-1);
  const position = latestPosition(event);

  const facts: Array<[string, string]> = [['Kind', categoryNames(event)]];
  if (first?.date && first.date !== last?.date) facts.push(['First reported', formatWhen(first.date, true)]);
  if (last?.date) facts.push(['Latest report', formatWhen(last.date, true)]);
  if (event.closed) facts.push(['Ended', formatWhen(event.closed, true)]);
  const magnitude = formatMagnitude(last);
  if (magnitude) facts.push([last?.magnitudeUnit === 'kts' ? 'Wind' : 'Size', magnitude]);
  if (position) facts.push(['Position', formatPosition(position)]);
  if (geometry.length > 1) facts.push(['Reports', String(geometry.length)]);

  const list = el('dl', 'events-facts');
  for (const [term, value] of facts) list.append(el('div', '', el('dt', '', term), el('dd', '', value)));

  const parts: Node[] = [list];
  if (event.description) parts.push(el('p', '', event.description));
  const chart = magnitudeChart(geometry);
  if (chart) parts.push(chart);

  const sources = (event.sources ?? []).filter((source) => /^https?:\/\//.test(source.url ?? ''));
  if (sources.length) {
    const line = el('p', 'events-detail__sources', 'Reported by ');
    sources.forEach((source, index) => {
      const link = el('a', '', source.id || 'source');
      link.href = source.url as string;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      line.append(index ? ', ' : '', link);
    });
    line.append('.');
    parts.push(line);
  }

  detailTitle.textContent = eventTitle(event);
  detailEl.replaceChildren(...parts);
}

function selectEvent(event: EonetEvent, { centerOnMap = true } = {}): void {
  activeEventId = event.id;
  highlightActive();
  const track = renderTrack(event);
  renderDetail(event);

  // Keep enough of the surrounding coastline in view to tell where on Earth this is.
  if (centerOnMap && track.length > 1) {
    map.flyToBounds(L.latLngBounds(track).pad(0.8), { maxZoom: 3, duration: 0.6 });
  } else if (centerOnMap && track.length) {
    map.flyTo(track[0], Math.min(Math.max(map.getZoom(), 2.5), 3.5), { duration: 0.6 });
  }
  listEl.querySelector<HTMLElement>('li.active')?.scrollIntoView({ block: 'nearest' });
}

// --- Loading -----------------------------------------------------------------

let listRequest: AbortController | null = null;

async function loadEvents(): Promise<void> {
  const start = startInput.value;
  const end = endInput.value;
  if (!start || !end) return;

  listRequest?.abort();
  const controller = new AbortController();
  listRequest = controller;

  if (submitButton) submitButton.disabled = true;
  countEl.textContent = 'Asking EONET.';
  try {
    const loaded = await fetchEonetEvents(
      { status: statusSelect.value, start, end, category: categorySelect.value || undefined },
      controller.signal,
    );
    if (controller.signal.aborted) return;

    for (const event of loaded) event.id = String(event.id);
    loaded.sort((a, b) => lastSeen(b).localeCompare(lastSeen(a)));
    events = loaded;

    if (activeEventId && !events.some((event) => event.id === activeEventId)) resetDetail();
    renderMarkers();
    renderList();
    highlightActive();
    countEl.textContent = `${events.length} ${events.length === 1 ? 'event' : 'events'}, newest first`;
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) return;
    countEl.textContent = '';
    listMessage(stateArt('offline', `EONET could not be reached (${errorMessage(error)}).`));
  } finally {
    if (listRequest === controller && submitButton) submitButton.disabled = false;
  }
}

async function loadCategories(): Promise<void> {
  const categories = await fetchEonetCategories();
  categories.sort((a, b) => a.title.localeCompare(b.title));
  for (const category of categories) {
    categorySelect.append(new Option(category.title, category.id));
  }
}

startInput.value = isoDay(-7);
endInput.value = isoDay(0);

filtersForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void loadEvents();
});
for (const select of [statusSelect, categorySelect]) select.addEventListener('change', () => void loadEvents());

// The category list is a nicety; the page works without it.
loadCategories().catch((error) => console.error('EONET categories failed to load', error));
void loadEvents();
