/** Satellite 3D: live SGP4 propagation of TLE sets around a day/night Earth. */
import { getTLE, parseTLEList, searchTLE, type NormalizedTle, type TleApiMember } from '../../api/tle';
import { isAbortError } from '../../api/worker';
import { byId, escapeHtml, isTypingTarget } from '../../lib/dom';
import { toast, toastError } from '../../lib/toast';
import { initSiteNav } from '../../shell/nav';
import {
  EARTH_RADIUS_UNITS,
  EarthScene,
  type OrbitState,
  type SatelliteVisualState,
  type TrailState,
} from './earthScene';
import { formatTleAge, renderSearchResults } from './searchResults';
import { eciToLngLatAlt, gmstFromDate, normalizeLongitude, propEciKm, tleAgeDays, tleToSatrec, type SatRec } from './sgp4';
import {
  findNextEquatorCrossing,
  orientationFor,
  sampleOrbit,
  toSceneUnits,
  TrailBuffer,
  type EquatorCrossing,
  type Vec3,
} from './tracking';

interface SatelliteEntry extends NormalizedTle {
  satrec: SatRec;
  positionKm: Vec3;
  velocityKm: Vec3;
}

const ISS_ID = 25544;
// 48275 and 44362 were dropped: the TLE API no longer has records for them.
const SAMPLE_SAT_IDS = [ISS_ID, 49044, 48274, 39444, 39634];
const DEFAULT_COLOR = 0xffffff;
const ISS_COLOR = 0xffd166;
const SELECTED_COLOR = 0x22e7ff;
const HOVER_COLOR = 0x7ad4ff;
const BASE_SCALE = 0.78;
const SELECTED_SCALE = 1.18;
const MAX_RENDERED = 500;
const PROPAGATE_PER_FRAME = 400;
const TRAIL_INTERVAL_MS = 2000;
const ORBIT_CACHE_WINDOW_MS = 60_000;
const INFO_REFRESH_MS = 250;
const CLICK_SLOP_PX = 5;
const SAMPLE_IDLE_LABEL = 'Load sample satellites';

initSiteNav();

const ui = {
  searchInput: byId<HTMLInputElement>('search-input'),
  searchButton: byId<HTMLButtonElement>('search-btn'),
  sampleButton: byId<HTMLButtonElement>('sample-btn'),
  playButton: byId<HTMLButtonElement>('play-btn'),
  speedSelect: byId<HTMLSelectElement>('speed-select'),
  nowButton: byId<HTMLButtonElement>('now-btn'),
  timeReadout: byId('time-readout'),
  trailToggle: byId<HTMLInputElement>('trail-toggle'),
  infoPanel: byId('info'),
  searchResults: byId('search-results'),
  renderStatus: byId('render-status'),
  focusButton: byId<HTMLButtonElement>('focus-selected-btn'),
  clearButton: byId<HTMLButtonElement>('clear-selected-btn'),
  hoverTooltip: byId('hover-tooltip'),
};

const earthScene = new EarthScene(byId('canvas-holder'));
const canvas = earthScene.renderer.domElement;

let playing = true;
let speedMultiplier = 1;
let simTimeMs = Date.now();
let lastFrame = performance.now();
let propagateCursor = 0;
let selectedId: number | null = null;
let hoveredId: number | null = null;
let trailsEnabled = false;
let lastTrailSampleMs = 0;
let lastInfoRefresh = 0;
let equatorCrossing: (EquatorCrossing & { id: number; computedAt: number }) | null = null;
let activeSearch: AbortController | null = null;
let sampleLoading = false;

const satellites = new Map<number, SatelliteEntry>();
const orbitCache = new Map<number, { positions: Float32Array; timestamp: number }>();
const trail = new TrailBuffer();

const formatUtc = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
const nameOf = (id: number): string => satellites.get(id)?.name ?? `NORAD ${id}`;

/* ---------- Status readouts ---------- */

function updatePlayButton(): void {
  ui.playButton.textContent = playing ? 'Pause' : 'Play';
}

function updateTimeReadout(): void {
  ui.timeReadout.textContent = formatUtc(simTimeMs);
}

function updateRenderStatus(): void {
  const total = satellites.size;
  if (total === 0) {
    ui.renderStatus.textContent = 'Tip: load the sample set or search by name/ID to populate the scene.';
    return;
  }
  const parts: string[] = [];
  if (total > MAX_RENDERED) {
    parts.push(`Showing ${MAX_RENDERED.toLocaleString()} of ${total.toLocaleString()} satellites (use search to refine).`);
  }
  parts.push(
    selectedId
      ? 'Double-click a satellite or use “Focus Selected” to center the camera.'
      : 'Tip: double-click any satellite to center the camera.',
  );
  ui.renderStatus.textContent = parts.join(' ');
}

function setSearchLoading(loading: boolean): void {
  ui.searchButton.disabled = loading;
  ui.searchButton.classList.toggle('loading', loading);
  ui.searchButton.textContent = loading ? 'Searching…' : 'Search';
  ui.searchInput.setAttribute('aria-busy', String(loading));
}

function setSampleLoading(loading: boolean): void {
  sampleLoading = loading;
  ui.sampleButton.disabled = loading;
  ui.sampleButton.classList.toggle('loading', loading);
  ui.sampleButton.textContent = loading ? 'Loading…' : SAMPLE_IDLE_LABEL;
}

function markSelectedResult(): void {
  ui.searchResults.querySelectorAll<HTMLElement>('.result-item').forEach((element) => {
    element.classList.toggle('selected', Number(element.dataset.id) === selectedId);
  });
}

function renderInfoPanel(): void {
  const entry = selectedId === null ? undefined : satellites.get(selectedId);
  if (!entry) {
    ui.infoPanel.innerHTML = '<h2>No satellite selected</h2><p>Click a satellite to view telemetry.</p>';
    return;
  }
  const geodetic = eciToLngLatAlt(new Date(simTimeMs), entry.positionKm);
  const speed = Math.hypot(...entry.velocityKm);
  const crossing =
    equatorCrossing?.id === entry.id
      ? `${formatUtc(equatorCrossing.timeMs)} @ ${equatorCrossing.longitude.toFixed(1)}°`
      : 'n/a';
  const rows: Array<[string, string]> = [
    ['NORAD', String(entry.id)],
    ['Altitude', `${geodetic.altitude.toFixed(1)} km`],
    ['Velocity', `${speed.toFixed(2)} km/s`],
    ['Latitude', `${geodetic.latitude.toFixed(2)}°`],
    ['Longitude', `${normalizeLongitude(geodetic.longitude).toFixed(2)}°`],
    ['Next equator pass', crossing],
    ['TLE age', formatTleAge(Math.max(0, tleAgeDays(entry.epoch, new Date())))],
  ];
  ui.infoPanel.innerHTML =
    `<h2>${escapeHtml(entry.name)}</h2>` +
    rows.map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join('');
}

/* ---------- Selection ---------- */

function resetTrail(): void {
  trail.clear();
  lastTrailSampleMs = 0;
  earthScene.updateTrails([]);
}

function focusOnSelected(announce: boolean): void {
  const entry = selectedId === null ? undefined : satellites.get(selectedId);
  if (!entry) {
    if (announce) toastError('No satellite selected.');
    return;
  }
  earthScene.focusOn(toSceneUnits(entry.positionKm), { radius: EARTH_RADIUS_UNITS * 3 });
  if (announce) toast(`Focused on ${entry.name}`);
}

function clearSelection(announce: boolean): void {
  if (selectedId === null) return;
  selectedId = null;
  equatorCrossing = null;
  resetTrail();
  renderInfoPanel();
  markSelectedResult();
  updateRenderStatus();
  if (announce) toast('Selection cleared.');
}

function selectSatellite(id: number, options: { focus?: boolean; announce?: string } = {}): void {
  if (!satellites.has(id)) return;
  if (selectedId !== id) {
    resetTrail();
    equatorCrossing = null;
  }
  selectedId = id;
  propagateEntry(satellites.get(id)!, new Date(simTimeMs));
  renderInfoPanel();
  if (options.focus) focusOnSelected(false);
  markSelectedResult();
  updateRenderStatus();
  if (options.announce) toast(options.announce);
}

function colorFor(id: number): number {
  if (id === selectedId) return SELECTED_COLOR;
  if (id === hoveredId) return HOVER_COLOR;
  return id === ISS_ID ? ISS_COLOR : DEFAULT_COLOR;
}

/* ---------- Catalogue ---------- */

function propagateEntry(entry: SatelliteEntry, date: Date): boolean {
  const state = propEciKm(entry.satrec, date);
  if (!state) return false;
  entry.positionKm = state.position;
  entry.velocityKm = state.velocity;
  return true;
}

/** Adds a TLE to the scene. Returns false when it is already loaded or cannot be propagated. */
function addSatellite(tle: NormalizedTle): boolean {
  if (satellites.has(tle.id)) return false;
  const satrec = tleToSatrec(tle.line1, tle.line2);
  const state = propEciKm(satrec, new Date(simTimeMs));
  if (!state) return false;
  satellites.set(tle.id, { ...tle, satrec, positionKm: state.position, velocityKm: state.velocity });
  updateRenderStatus();
  return true;
}

async function loadSample(): Promise<void> {
  if (sampleLoading) return;
  setSampleLoading(true);
  try {
    const [searchResult, ...direct] = await Promise.all([
      searchTLE('ISS').catch(() => ({ member: [] })),
      ...SAMPLE_SAT_IDS.map((id) => getTLE(id).catch(() => null)),
    ]);
    const found = new Map<number, NormalizedTle>();
    for (const tle of parseTLEList(searchResult)) found.set(tle.id, tle);
    for (const tle of parseTLEList({ member: direct.filter((entry): entry is TleApiMember => entry !== null) })) found.set(tle.id, tle);

    if (found.size === 0) {
      toastError('No sample satellites available right now.');
      return;
    }
    let added = 0;
    found.forEach((tle) => {
      if (addSatellite(tle)) added += 1;
    });
    toast(
      added > 0
        ? `Loaded ${added.toLocaleString()} sample satellite${added === 1 ? '' : 's'}.`
        : 'The sample satellites are already in the scene.',
    );
    if (satellites.has(ISS_ID) && selectedId === null) {
      selectSatellite(ISS_ID, { focus: true });
    }
  } finally {
    setSampleLoading(false);
  }
}

function pickSearchResult(item: NormalizedTle): void {
  const added = addSatellite(item);
  if (!satellites.has(item.id)) {
    toastError(`${item.name} has orbital elements that can't be propagated right now.`);
    return;
  }
  selectSatellite(item.id, {
    focus: true,
    announce: added ? `Added and selected ${item.name}` : `Selected ${item.name}`,
  });
}

async function performSearch(): Promise<void> {
  const query = ui.searchInput.value.trim();
  activeSearch?.abort();
  activeSearch = null;
  if (!query) {
    ui.searchResults.replaceChildren();
    setSearchLoading(false);
    return;
  }
  const controller = new AbortController();
  activeSearch = controller;
  setSearchLoading(true);
  try {
    const items = parseTLEList(await searchTLE(query, controller.signal));
    if (controller.signal.aborted) return;
    renderSearchResults(ui.searchResults, items, {
      query,
      isLoaded: (id) => satellites.has(id),
      onPick: pickSearchResult,
    });
    markSelectedResult();
  } catch (error) {
    if (isAbortError(error)) return;
    toastError('Search failed. Please try again.');
  } finally {
    if (activeSearch === controller) {
      activeSearch = null;
      setSearchLoading(false);
    }
  }
}

/* ---------- Pointer interaction ---------- */

function pickAt(event: MouseEvent): number | null {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  return earthScene.pickSatellite(ndcX, ndcY)?.id ?? null;
}

function setHover(id: number | null, event?: MouseEvent): void {
  hoveredId = id;
  const tooltip = ui.hoverTooltip;
  canvas.style.cursor = id === null ? '' : 'pointer';
  if (id === null) {
    tooltip.removeAttribute('data-visible');
    tooltip.setAttribute('aria-hidden', 'true');
    tooltip.style.transform = 'translate(-9999px, -9999px)';
    return;
  }
  tooltip.textContent = nameOf(id);
  if (event) tooltip.style.transform = `translate(${event.clientX + 16}px, ${event.clientY + 16}px)`;
  tooltip.dataset.visible = 'true';
  tooltip.setAttribute('aria-hidden', 'false');
}

/** Selects on click rather than press, so dragging to orbit the camera never changes selection. */
function initPointerSelection(): void {
  let pressX = 0;
  let pressY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    pressX = event.clientX;
    pressY = event.clientY;
  });
  canvas.addEventListener('click', (event) => {
    if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > CLICK_SLOP_PX) return;
    const id = pickAt(event);
    if (id === null) return;
    const focus = event.detail >= 2;
    selectSatellite(id, { focus, announce: `${focus ? 'Focused on' : 'Selected'} ${nameOf(id)}` });
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.buttons !== 0) return;
    setHover(pickAt(event), event);
  });
  canvas.addEventListener('pointerleave', () => setHover(null));
}

/* ---------- Frame loop ---------- */

function orbitFor(entry: SatelliteEntry, date: Date): Float32Array | null {
  const cached = orbitCache.get(entry.id);
  if (cached && Math.abs(cached.timestamp - simTimeMs) < ORBIT_CACHE_WINDOW_MS) return cached.positions;
  const positions = sampleOrbit(entry.satrec, date);
  if (positions) orbitCache.set(entry.id, { positions, timestamp: simTimeMs });
  else orbitCache.delete(entry.id);
  return positions;
}

function updateScene(deltaMs: number, now: number): void {
  if (playing) simTimeMs += deltaMs * speedMultiplier;
  const date = new Date(simTimeMs);
  earthScene.setSunDirectionFromDate(date);
  earthScene.updateEarthOrientation(gmstFromDate(date));

  const all = Array.from(satellites.values());
  const selected = selectedId === null ? undefined : satellites.get(selectedId);

  // Propagate a bounded batch per frame so very large sets stay smooth; the selection is always fresh.
  const batch = Math.min(PROPAGATE_PER_FRAME, all.length);
  for (let i = 0; i < batch; i += 1) {
    propagateEntry(all[(propagateCursor + i) % all.length], date);
  }
  propagateCursor = all.length ? (propagateCursor + batch) % all.length : 0;
  if (selected) propagateEntry(selected, date);

  const visible = all.slice(0, MAX_RENDERED);
  if (selected && !visible.includes(selected)) visible[visible.length - 1] = selected;

  const states: SatelliteVisualState[] = [];
  const orbits: OrbitState[] = [];
  for (const sat of visible) {
    const color = colorFor(sat.id);
    states.push({
      id: sat.id,
      position: toSceneUnits(sat.positionKm),
      color,
      scale: sat.id === selectedId ? SELECTED_SCALE : BASE_SCALE,
      quaternion: orientationFor(sat.positionKm, sat.velocityKm) ?? undefined,
    });
    const positions = orbitFor(sat, date);
    if (positions) orbits.push({ id: sat.id, positions, color });
  }
  earthScene.updateSatellites(states);
  earthScene.updateOrbits(orbits);

  const trails: TrailState[] = [];
  if (trailsEnabled && selected) {
    if (now - lastTrailSampleMs > TRAIL_INTERVAL_MS) {
      trail.push(toSceneUnits(selected.positionKm));
      lastTrailSampleMs = now;
    }
    trails.push({ id: selected.id, positions: trail.positions(), count: trail.count });
  }
  earthScene.updateTrails(trails);

  if (selected && (equatorCrossing?.id !== selected.id || Math.abs(equatorCrossing.computedAt - simTimeMs) > 60_000)) {
    const crossing = findNextEquatorCrossing(selected.satrec, simTimeMs);
    equatorCrossing = crossing ? { ...crossing, id: selected.id, computedAt: simTimeMs } : null;
  }
  if (now - lastInfoRefresh > INFO_REFRESH_MS) {
    lastInfoRefresh = now;
    renderInfoPanel();
    updateTimeReadout();
  }
}

function animate(): void {
  const now = performance.now();
  // Clamp so a backgrounded tab does not leap forward by minutes at high playback speeds.
  const deltaMs = Math.min(now - lastFrame, 250);
  lastFrame = now;
  updateScene(deltaMs, now);
  earthScene.render();
  requestAnimationFrame(animate);
}

/* ---------- Wiring ---------- */

ui.playButton.addEventListener('click', () => {
  playing = !playing;
  updatePlayButton();
});

ui.speedSelect.addEventListener('change', () => {
  const value = Number(ui.speedSelect.value);
  speedMultiplier = Number.isFinite(value) ? value : 1;
});

ui.nowButton.addEventListener('click', () => {
  simTimeMs = Date.now();
  orbitCache.clear();
  resetTrail();
  updateTimeReadout();
});

ui.searchButton.addEventListener('click', () => void performSearch());
ui.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void performSearch();
});
ui.sampleButton.addEventListener('click', () => void loadSample());

ui.trailToggle.addEventListener('change', () => {
  trailsEnabled = ui.trailToggle.checked;
  resetTrail();
});

ui.focusButton.addEventListener('click', () => focusOnSelected(true));
ui.clearButton.addEventListener('click', () => clearSelection(true));

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !isTypingTarget(event.target)) clearSelection(false);
});

initPointerSelection();
updatePlayButton();
updateTimeReadout();
updateRenderStatus();
animate();
void loadSample();
