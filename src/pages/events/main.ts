/** EONET Explorer: natural events on a map, with a filterable list and detail pane. */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// After Leaflet's stylesheet so the dark-theme overrides win.
import '../../styles/events.css';
import {
  fetchEonetCategories,
  fetchEonetEventMarkdown,
  fetchEonetEvents,
  type EonetEvent,
} from '../../api/eonet';
import { isAbortError } from '../../api/worker';
import { byId, escapeHtml } from '../../lib/dom';
import { renderMarkdown } from '../../lib/markdown';
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

const CATEGORY_COLORS: Record<string, string> = {
  wildfires: '#ff6b6b',
  severeStorms: '#5ac8fa',
  volcanoes: '#ffb703',
  floods: '#56d364',
  seaLakeIce: '#8ea2bb',
  dustHaze: '#b088f5',
  landslides: '#d19a66',
  snow: '#c0cbdc',
  waterColor: '#7fbf7f',
  temperatureExtremes: '#e07a5f',
};
const DEFAULT_COLOR = '#c0cbdc';
const colorFor = (categoryId: string | undefined) => CATEGORY_COLORS[categoryId ?? ''] ?? DEFAULT_COLOR;

const MARKER_STYLE = { radius: 6, weight: 1.5, color: '#0b0f14', opacity: 1, fillOpacity: 0.9 };

function isoDay(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const eventTitle = (event: EonetEvent) => event.title || event.id;
const categoryNames = (event: EonetEvent) =>
  event.categories?.map((category) => category.title).join(', ') || 'Uncategorized';
const lastSeen = (event: EonetEvent) => event.geometry?.at(-1)?.date ?? '';

/** Most recent position of an event; polygons collapse to their first vertex. */
function latestPosition(event: EonetEvent): L.LatLngTuple | null {
  let coords = event.geometry?.at(-1)?.coordinates;
  while (Array.isArray(coords) && Array.isArray(coords[0])) coords = coords[0];
  if (!Array.isArray(coords)) return null;
  const [lon, lat] = coords.map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

// --- Map -------------------------------------------------------------------

const map = L.map(byId('map'), { worldCopyJump: true }).setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 8,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const markersLayer = L.layerGroup().addTo(map);
const markers = new Map<string, L.CircleMarker>();
window.addEventListener('resize', () => map.invalidateSize());

let activeEventId: string | null = null;

function renderMarkers(events: EonetEvent[]): void {
  markersLayer.clearLayers();
  markers.clear();

  const positions: L.LatLngTuple[] = [];
  const legend = new Map<string, string>();

  for (const event of events) {
    const position = latestPosition(event);
    if (!position) continue;
    const category = event.categories?.[0];
    const seen = lastSeen(event);

    const marker = L.circleMarker(position, { ...MARKER_STYLE, fillColor: colorFor(category?.id) });
    // Titles come from an upstream API; Leaflet popups take HTML, so escape them.
    marker.bindPopup(
      `<strong>${escapeHtml(eventTitle(event))}</strong><br />${escapeHtml(categoryNames(event))}` +
        (seen ? `<br />${escapeHtml(seen)}` : ''),
    );
    marker.bindTooltip(escapeHtml(eventTitle(event)), { direction: 'top' });
    marker.on('click', () => void selectEvent(event, { centerOnMap: false }));
    marker.addTo(markersLayer);

    markers.set(event.id, marker);
    positions.push(position);
    if (category) legend.set(category.id, category.title);
  }

  if (positions.length) map.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: 6 });
  else map.setView([20, 0], 2);

  legendEl.innerHTML =
    [...legend]
      .slice(0, 8)
      .map(
        ([id, title]) =>
          `<span class="badge"><span class="swatch" style="background:${colorFor(id)}"></span>${escapeHtml(title)}</span>`,
      )
      .join(' ') || '<span class="small">No categories</span>';
}

function highlightActive(): void {
  for (const item of listEl.querySelectorAll<HTMLElement>('li[data-event-id]')) {
    item.classList.toggle('active', item.dataset.eventId === activeEventId);
  }
  for (const [id, marker] of markers) {
    const active = id === activeEventId;
    marker.setStyle({
      radius: active ? MARKER_STYLE.radius * 1.4 : MARKER_STYLE.radius,
      weight: active ? 3 : MARKER_STYLE.weight,
      fillOpacity: active ? 1 : MARKER_STYLE.fillOpacity,
    });
    if (active) marker.bringToFront();
    else marker.closePopup();
  }
}

// --- List and detail ---------------------------------------------------------

function listMessage(text: string): void {
  const item = document.createElement('li');
  item.className = 'small';
  item.textContent = text;
  listEl.replaceChildren(item);
}

function renderList(events: EonetEvent[]): void {
  if (!events.length) {
    listMessage('No events in range.');
    return;
  }
  listEl.replaceChildren(
    ...events.map((event) => {
      const title = document.createElement('div');
      title.textContent = eventTitle(event);
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${categoryNames(event)} • ${lastSeen(event)}`;

      const item = document.createElement('li');
      item.dataset.eventId = event.id;
      item.tabIndex = 0;
      item.append(title, meta);
      item.addEventListener('click', () => void selectEvent(event));
      item.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return;
        keyEvent.preventDefault();
        void selectEvent(event);
      });
      return item;
    }),
  );
}

let detailRequest: AbortController | null = null;

function resetDetail(): void {
  detailRequest?.abort();
  activeEventId = null;
  detailTitle.textContent = 'Event Detail';
  detailEl.textContent = 'Pick an event.';
}

async function selectEvent(event: EonetEvent, { centerOnMap = true } = {}): Promise<void> {
  activeEventId = event.id;
  highlightActive();

  const position = latestPosition(event);
  if (centerOnMap && position) map.flyTo(position, Math.max(map.getZoom(), 4), { duration: 0.65 });
  markers.get(event.id)?.openPopup();

  detailRequest?.abort();
  const controller = new AbortController();
  detailRequest = controller;

  detailTitle.textContent = eventTitle(event);
  detailEl.textContent = 'Loading…';
  try {
    const markdown = await fetchEonetEventMarkdown(event.id, controller.signal);
    if (!controller.signal.aborted) detailEl.innerHTML = renderMarkdown(markdown);
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) return;
    const failure = document.createElement('p');
    failure.className = 'error';
    failure.textContent = `Failed to load event (${errorMessage(error)}).`;
    detailEl.replaceChildren(failure);
  }
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
  listMessage('Loading events…');
  try {
    const events = await fetchEonetEvents(
      { status: statusSelect.value, start, end, category: categorySelect.value || undefined },
      controller.signal,
    );
    if (controller.signal.aborted) return;

    for (const event of events) event.id = String(event.id);
    events.sort((a, b) => lastSeen(b).localeCompare(lastSeen(a)));

    if (activeEventId && !events.some((event) => event.id === activeEventId)) resetDetail();
    renderMarkers(events);
    renderList(events);
    highlightActive();
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) return;
    listMessage(`Error: ${errorMessage(error)}`);
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

// The category list is a nicety; the page works without it.
loadCategories().catch((error) => console.error('EONET categories failed to load', error));
void loadEvents();
