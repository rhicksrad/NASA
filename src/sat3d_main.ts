import * as THREE from 'three';
import {
  EarthScene,
  KM_TO_UNITS,
  LabelState,
  SatelliteVisualState,
  TrailState,
  EARTH_RADIUS_UNITS,
  OrbitState,
} from './earth_scene';
import { getTLE, parseTLEList, searchTLE, NormalizedTle, TleSearchResponse } from './tle_client';
import { SatRec, eciToLngLatAlt, gmstFromDate, propEciKm, tleAgeDays, tleToSatrec } from './sat_sgp4';

interface SatelliteEntry extends NormalizedTle {
  satrec: SatRec;
  lastPositionKm: [number, number, number] | null;
  lastVelocityKm: [number, number, number] | null;
  lastUpdateMs: number;
}

interface TrailHistory {
  buffer: Float32Array;
  output: Float32Array;
  index: number;
  count: number;
}

const SAMPLE_SAT_IDS = [25544, 49044, 48275, 48274, 44362, 39444, 39634];
const DEFAULT_COLOR = 0xffffff;
const ISS_COLOR = 0xffd166;
const SELECTED_COLOR = 0x22e7ff;
const MAX_RENDERED = 500;
const PROPAGATE_PER_FRAME = 400;
const TRAIL_CAPACITY = 180;
const TRAIL_INTERVAL_MS = 2000;
const ORBIT_SAMPLE_COUNT = 192;
const ORBIT_SPAN_MINUTES = 96;
const ORBIT_CACHE_WINDOW_MS = 60_000;
const SEARCH_IDLE_LABEL = 'Search';
const SEARCH_LOADING_LABEL = 'Searching…';
const SAMPLE_IDLE_LABEL = 'Load Sample (Top ISS + debris)';
const SAMPLE_LOADING_LABEL = 'Loading…';

const canvasHolder = document.getElementById('canvas-holder');
if (!canvasHolder) {
  throw new Error('Missing canvas holder');
}

const ui = {
  searchInput: document.getElementById('search-input') as HTMLInputElement,
  searchButton: document.getElementById('search-btn') as HTMLButtonElement,
  sampleButton: document.getElementById('sample-btn') as HTMLButtonElement,
  playButton: document.getElementById('play-btn') as HTMLButtonElement,
  speedSelect: document.getElementById('speed-select') as HTMLSelectElement,
  nowButton: document.getElementById('now-btn') as HTMLButtonElement,
  timeReadout: document.getElementById('time-readout') as HTMLDivElement,
  trailToggle: document.getElementById('trail-toggle') as HTMLInputElement,
  labelsToggle: document.getElementById('labels-toggle') as HTMLInputElement,
  infoPanel: document.getElementById('info') as HTMLDivElement,
  searchResults: document.getElementById('search-results') as HTMLDivElement,
  toastContainer: document.getElementById('toast-container') as HTMLDivElement,
  renderStatus: document.getElementById('render-status') as HTMLDivElement,
  focusButton: document.getElementById('focus-selected-btn') as HTMLButtonElement,
  clearButton: document.getElementById('clear-selected-btn') as HTMLButtonElement,
};

const earthScene = new EarthScene(canvasHolder);

let playing = true;
let speedMultiplier = 1;
let simTimeMs = Date.now();
let lastFrame = performance.now();
let propagateCursor = 0;
let selectedId: number | null = null;
let labelsEnabled = true;
let trailsEnabled = false;
let lastTrailStamp = 0;
let nextEquatorCache: { id: number; timeMs: number; longitude: number; computedAt: number } | null = null;
let lastLabelRefresh = 0;
let activeSearchAbort: AbortController | null = null;
let sampleLoading = false;

const satellites = new Map<number, SatelliteEntry>();
const trailHistories = new Map<number, TrailHistory>();
const orbitCache = new Map<number, { positions: Float32Array; timestamp: number }>();

const tempForward = new THREE.Vector3();
const tempUp = new THREE.Vector3();
const tempRight = new THREE.Vector3();
const tempMatrix = new THREE.Matrix4();
const tempQuaternion = new THREE.Quaternion();

function showToast(message: string, isError = false, timeout = 4500): void {
  if (!ui.toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  ui.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, timeout);
}

function updatePlayButton(): void {
  if (!ui.playButton) return;
  ui.playButton.textContent = playing ? 'Pause' : 'Play';
}

function updateTimeReadout(): void {
  if (!ui.timeReadout) return;
  const date = new Date(simTimeMs);
  ui.timeReadout.textContent = `${date.toISOString().replace('T', ' ').replace('Z', ' UTC')}`;
}

function updateRenderStatus(): void {
  if (!ui.renderStatus) return;
  const total = satellites.size;
  if (total === 0) {
    ui.renderStatus.textContent = 'Tip: load the sample set or search by name/ID to populate the scene.';
    return;
  }
  const parts: string[] = [];
  if (total > MAX_RENDERED) {
    parts.push(`Showing ${MAX_RENDERED.toLocaleString()} of ${total.toLocaleString()} satellites (use search to refine).`);
  }
  if (selectedId) {
    parts.push('Double-click a satellite or use “Focus Selected” to center the camera.');
  } else {
    parts.push('Tip: double-click any satellite to center the camera.');
  }
  ui.renderStatus.textContent = parts.join(' ');
}

function setSearchLoading(loading: boolean): void {
  if (ui.searchButton) {
    ui.searchButton.disabled = loading;
    ui.searchButton.classList.toggle('loading', loading);
    ui.searchButton.textContent = loading ? SEARCH_LOADING_LABEL : SEARCH_IDLE_LABEL;
  }
  if (ui.searchInput) {
    ui.searchInput.setAttribute('aria-busy', loading ? 'true' : 'false');
  }
}

function setSampleLoading(loading: boolean): void {
  sampleLoading = loading;
  if (ui.sampleButton) {
    ui.sampleButton.disabled = loading;
    ui.sampleButton.classList.toggle('loading', loading);
    ui.sampleButton.textContent = loading ? SAMPLE_LOADING_LABEL : SAMPLE_IDLE_LABEL;
  }
}

function updateSearchSelection(): void {
  if (!ui.searchResults) return;
  const items = ui.searchResults.querySelectorAll<HTMLDivElement>('.result-item');
  items.forEach((element) => {
    const id = Number(element.dataset.id);
    element.classList.toggle('selected', Number.isFinite(id) && id === selectedId);
  });
}

function focusOnSelected(announce = true): void {
  if (!selectedId) {
    if (announce) {
      showToast('No satellite selected.', true);
    }
    return;
  }
  const entry = satellites.get(selectedId);
  if (!entry || !entry.lastPositionKm) {
    if (announce) {
      showToast('Position unavailable. Waiting for propagation…', true);
    }
    return;
  }
  earthScene.focusOn(
    [
      entry.lastPositionKm[0] * KM_TO_UNITS,
      entry.lastPositionKm[1] * KM_TO_UNITS,
      entry.lastPositionKm[2] * KM_TO_UNITS,
    ],
    { radius: EARTH_RADIUS_UNITS * 4 }
  );
  if (announce) {
    showToast(`Focused on ${entry.name}`);
  }
}

function clearSelection(showToastMessage = true): void {
  if (selectedId === null) {
    return;
  }
  if (trailsEnabled) {
    trailHistories.clear();
    earthScene.updateTrails([]);
  }
  selectedId = null;
  nextEquatorCache = null;
  updateInfoPanel(null, new Date(simTimeMs));
  updateSearchSelection();
  updateRenderStatus();
  if (showToastMessage) {
    showToast('Selection cleared.');
  }
}

function selectSatellite(id: number, options?: { focus?: boolean; toast?: string }): void {
  const entry = satellites.get(id);
  if (!entry) {
    return;
  }
  if (trailsEnabled && selectedId !== id) {
    trailHistories.clear();
    earthScene.updateTrails([]);
    lastTrailStamp = 0;
  }
  selectedId = id;
  nextEquatorCache = null;
  const date = new Date(simTimeMs);
  const immediate = propEciKm(entry.satrec, date);
  if (immediate) {
    entry.lastPositionKm = immediate.position;
    entry.lastVelocityKm = immediate.velocity;
    entry.lastUpdateMs = simTimeMs;
  }
  updateInfoPanel(entry, date);
  if (options?.focus) {
    focusOnSelected(false);
  }
  updateSearchSelection();
  updateRenderStatus();
  if (options?.toast) {
    showToast(options.toast);
  }
}

function computeColor(id: number): number {
  if (id === 25544) return ISS_COLOR;
  if (id === selectedId) return SELECTED_COLOR;
  return DEFAULT_COLOR;
}

function computeOrientation(entry: SatelliteEntry): [number, number, number, number] | null {
  if (!entry.lastVelocityKm || !entry.lastPositionKm) return null;
  tempForward.set(entry.lastVelocityKm[0], entry.lastVelocityKm[1], entry.lastVelocityKm[2]);
  if (!Number.isFinite(tempForward.lengthSq()) || tempForward.lengthSq() < 1e-8) {
    return null;
  }
  tempForward.normalize();

  tempUp.set(entry.lastPositionKm[0], entry.lastPositionKm[1], entry.lastPositionKm[2]);
  if (!Number.isFinite(tempUp.lengthSq()) || tempUp.lengthSq() < 1e-8) {
    tempUp.set(0, 1, 0);
  } else {
    tempUp.normalize();
  }

  if (Math.abs(tempForward.dot(tempUp)) > 0.95) {
    tempUp.set(0, 1, 0);
  }

  tempRight.copy(tempForward).cross(tempUp);
  if (!Number.isFinite(tempRight.lengthSq()) || tempRight.lengthSq() < 1e-8) {
    return null;
  }
  tempRight.normalize();
  tempUp.copy(tempRight).cross(tempForward).normalize();

  tempMatrix.makeBasis(tempRight, tempUp, tempForward);
  tempQuaternion.setFromRotationMatrix(tempMatrix);
  return [tempQuaternion.x, tempQuaternion.y, tempQuaternion.z, tempQuaternion.w];
}

function computeOrbitPositions(entry: SatelliteEntry, date: Date): Float32Array | null {
  const spanMs = ORBIT_SPAN_MINUTES * 60_000;
  if (spanMs <= 0) return null;
  const startMs = date.getTime() - spanMs / 2;
  const step = spanMs / Math.max(1, ORBIT_SAMPLE_COUNT - 1);
  const positions = new Float32Array(ORBIT_SAMPLE_COUNT * 3);
  let count = 0;
  for (let i = 0; i < ORBIT_SAMPLE_COUNT; i += 1) {
    const time = startMs + step * i;
    const propagation = propEciKm(entry.satrec, new Date(time));
    if (!propagation) {
      continue;
    }
    positions[count * 3] = propagation.position[0] * KM_TO_UNITS;
    positions[count * 3 + 1] = propagation.position[1] * KM_TO_UNITS;
    positions[count * 3 + 2] = propagation.position[2] * KM_TO_UNITS;
    count += 1;
  }
  if (count < 2) {
    return null;
  }
  if (count < ORBIT_SAMPLE_COUNT) {
    return positions.slice(0, count * 3);
  }
  return positions;
}

function getOrbitPositions(entry: SatelliteEntry, date: Date): Float32Array | null {
  const cached = orbitCache.get(entry.id);
  if (cached && Math.abs(cached.timestamp - simTimeMs) < ORBIT_CACHE_WINDOW_MS) {
    return cached.positions;
  }
  const computed = computeOrbitPositions(entry, date);
  if (computed) {
    orbitCache.set(entry.id, { positions: computed, timestamp: simTimeMs });
    return computed;
  }
  orbitCache.delete(entry.id);
  return null;
}

function ensureTrailHistory(id: number): TrailHistory {
  let history = trailHistories.get(id);
  if (!history) {
    history = {
      buffer: new Float32Array(TRAIL_CAPACITY * 3),
      output: new Float32Array(TRAIL_CAPACITY * 3),
      index: 0,
      count: 0,
    };
    trailHistories.set(id, history);
  }
  return history;
}

function pushTrailSample(id: number, positionUnits: [number, number, number]): void {
  const history = ensureTrailHistory(id);
  history.buffer.set(positionUnits, history.index * 3);
  history.index = (history.index + 1) % TRAIL_CAPACITY;
  history.count = Math.min(history.count + 1, TRAIL_CAPACITY);
}

function buildTrailState(id: number): TrailState | null {
  const history = trailHistories.get(id);
  if (!history || history.count === 0) return null;
  const { buffer, output, index, count } = history;
  let cursor = 0;
  for (let i = 0; i < count; i += 1) {
    const srcIndex = (index + TRAIL_CAPACITY - count + i) % TRAIL_CAPACITY;
    output.set(buffer.subarray(srcIndex * 3, srcIndex * 3 + 3), cursor);
    cursor += 3;
  }
  return { id, positions: output, count };
}

function removeTrail(id: number): void {
  trailHistories.delete(id);
}

function addSatellite(tle: NormalizedTle): boolean {
  if (satellites.has(tle.id)) return false;
  const satrec = tleToSatrec(tle.line1, tle.line2);
  const initialState = propEciKm(satrec, new Date(simTimeMs));
  satellites.set(tle.id, {
    ...tle,
    satrec,
    lastPositionKm: initialState ? initialState.position : null,
    lastVelocityKm: initialState ? initialState.velocity : null,
    lastUpdateMs: initialState ? simTimeMs : 0,
  });
  updateRenderStatus();
  return true;
}

async function loadSample(): Promise<void> {
  if (sampleLoading) return;
  setSampleLoading(true);
  try {
    const [searchResult, ...direct] = await Promise.all([
      searchTLE('ISS').catch((error) => {
        // eslint-disable-next-line no-console
        console.warn('Sample search failed', error);
        return { member: [] } satisfies TleSearchResponse;
      }),
      ...SAMPLE_SAT_IDS.map((id) =>
        getTLE(id).catch((error) => {
          // eslint-disable-next-line no-console
          console.warn('Failed to fetch TLE', id, error);
          return null;
        })
      ),
    ]);
    const normalized = new Map<number, NormalizedTle>();
    for (const tle of parseTLEList(searchResult)) {
      normalized.set(tle.id, tle);
    }
    for (const entry of direct) {
      if (entry) {
        normalized.set(entry.satelliteId, {
          id: entry.satelliteId,
          name: entry.name,
          line1: entry.line1,
          line2: entry.line2,
          epoch: new Date(entry.date),
        });
      }
    }
    let added = 0;
    normalized.forEach((tle) => {
      if (addSatellite(tle)) {
        added += 1;
      }
    });
    if (normalized.size === 0) {
      showToast('No sample satellites available right now.', true);
    } else {
      const messageParts = [`Loaded ${normalized.size.toLocaleString()} satellites.`];
      messageParts.push(
        added > 0
          ? `${added.toLocaleString()} new.`
          : 'All were already in the scene.'
      );
      showToast(messageParts.join(' '));
    }
    if (normalized.has(25544)) {
      selectSatellite(25544, { focus: true, toast: 'Selected International Space Station' });
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    showToast('Failed to load sample satellites.', true);
  } finally {
    setSampleLoading(false);
  }
}

function handleResultSelection(item: NormalizedTle): void {
  const wasAdded = addSatellite(item);
  if (!satellites.has(item.id)) {
    showToast('Unable to load that satellite. Please try again.', true);
    return;
  }
  const toast = wasAdded ? `Added and selected ${item.name}` : `Selected ${item.name}`;
  selectSatellite(item.id, { focus: true, toast });
}

function renderSearchResults(items: NormalizedTle[], query?: string): void {
  if (!ui.searchResults) return;
  ui.searchResults.innerHTML = '';
  const now = new Date();
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'search-status';
    empty.textContent = query && query.trim().length > 0 ? `No results for “${query}”.` : 'No results.';
    ui.searchResults.appendChild(empty);
    updateSearchSelection();
    return;
  }
  const limited = items.length > 50;
  const subset = items.slice(0, 50);
  if (query && query.trim().length > 0) {
    const status = document.createElement('div');
    status.className = 'search-status';
    status.textContent = limited
      ? `Showing first ${subset.length} of ${items.length} results for “${query}”.`
      : `Showing ${subset.length} result${subset.length === 1 ? '' : 's'} for “${query}”.`;
    ui.searchResults.appendChild(status);
  }
  for (const item of subset) {
    const entry = document.createElement('div');
    entry.className = 'result-item';
    entry.dataset.id = String(item.id);
    entry.setAttribute('role', 'button');
    entry.tabIndex = 0;
    const name = document.createElement('div');
    name.className = 'result-name';
    name.textContent = `${item.name} · ${item.id}`;
    entry.appendChild(name);
    const ageDays = Math.max(0, tleAgeDays(item.epoch, now));
    const meta = document.createElement('div');
    meta.className = 'result-meta';
    const parts: string[] = [];
    if (ageDays < 0.1) {
      parts.push('TLE age: <0.1 day');
    } else if (ageDays < 2) {
      parts.push(`TLE age: ${ageDays.toFixed(2)} days`);
    } else if (ageDays < 10) {
      parts.push(`TLE age: ${ageDays.toFixed(1)} days`);
    } else {
      parts.push(`TLE age: ${ageDays.toFixed(0)} days`);
    }
    if (satellites.has(item.id)) {
      parts.push('Loaded');
      entry.classList.add('selected');
    }
    if (ageDays > 7) {
      entry.classList.add('stale');
    }
    meta.textContent = parts.join(' • ');
    entry.appendChild(meta);
    entry.addEventListener('click', () => handleResultSelection(item));
    entry.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleResultSelection(item);
      }
    });
    ui.searchResults.appendChild(entry);
  }
  updateSearchSelection();
}

async function performSearch(): Promise<void> {
  const query = ui.searchInput?.value ?? '';
  const trimmed = query.trim();
  if (!trimmed) {
    if (activeSearchAbort) {
      activeSearchAbort.abort();
      activeSearchAbort = null;
    }
    renderSearchResults([], '');
    setSearchLoading(false);
    return;
  }
  if (activeSearchAbort) {
    activeSearchAbort.abort();
  }
  const controller = new AbortController();
  activeSearchAbort = controller;
  setSearchLoading(true);
  try {
    const response = await searchTLE(trimmed, controller.signal);
    if (controller.signal.aborted) {
      return;
    }
    const list = parseTLEList(response);
    renderSearchResults(list, trimmed);
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') {
      return;
    }
    // eslint-disable-next-line no-console
    console.error(error);
    showToast('Search failed. Please try again.', true);
  } finally {
    if (activeSearchAbort === controller) {
      activeSearchAbort = null;
      setSearchLoading(false);
    }
  }
}

function updateInfoPanel(entry: SatelliteEntry | null, date: Date): void {
  if (!ui.infoPanel) return;
  if (!entry || !entry.lastPositionKm || !entry.lastVelocityKm) {
    ui.infoPanel.innerHTML = '<h2>No satellite selected</h2><p>Click a satellite to view telemetry.</p>';
    return;
  }
  const geodetic = eciToLngLatAlt(date, entry.lastPositionKm);
  const velocity = Math.sqrt(
    entry.lastVelocityKm[0] ** 2 + entry.lastVelocityKm[1] ** 2 + entry.lastVelocityKm[2] ** 2
  );
  const tleAge = tleAgeDays(entry.epoch, new Date());
  const lon = ((geodetic.longitude + 540) % 360) - 180;
  const lat = geodetic.latitude;
  const altitude = geodetic.altitude;
  let equatorText = 'n/a';
  if (nextEquatorCache && nextEquatorCache.id === entry.id) {
    const crossingDate = new Date(nextEquatorCache.timeMs);
    equatorText = `${crossingDate.toISOString().replace('T', ' ').replace('Z', ' UTC')} @ ${nextEquatorCache.longitude.toFixed(1)}°`;
  }
  ui.infoPanel.innerHTML = `
    <h2>${entry.name}</h2>
    <p><strong>NORAD:</strong> ${entry.id}</p>
    <p><strong>Altitude:</strong> ${altitude.toFixed(1)} km</p>
    <p><strong>Velocity:</strong> ${velocity.toFixed(2)} km/s</p>
    <p><strong>Latitude:</strong> ${lat.toFixed(2)}°</p>
    <p><strong>Longitude:</strong> ${lon.toFixed(2)}°</p>
    <p><strong>Next equator pass:</strong> ${equatorText}</p>
    <p><strong>TLE age:</strong> ${tleAge.toFixed(2)} days</p>
  `;
}

function updateLabels(): LabelState[] {
  if (!labelsEnabled) return [];
  const entries = Array.from(satellites.values())
    .filter((sat) => sat.lastPositionKm)
    .map((sat) => {
      const pos = sat.lastPositionKm!;
      const dx = pos[0] * KM_TO_UNITS - earthScene.camera.position.x;
      const dy = pos[1] * KM_TO_UNITS - earthScene.camera.position.y;
      const dz = pos[2] * KM_TO_UNITS - earthScene.camera.position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return { sat, distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 40);
  return entries.map(({ sat }) => ({
    id: sat.id,
    text: sat.name,
    position: [sat.lastPositionKm![0] * KM_TO_UNITS, sat.lastPositionKm![1] * KM_TO_UNITS, sat.lastPositionKm![2] * KM_TO_UNITS],
  }));
}

function updateNextEquatorPass(entry: SatelliteEntry, startDate: Date): void {
  const startMs = startDate.getTime();
  let prevLat: number | null = null;
  let prevTime = startMs;
  const stepMs = 60_000;
  const maxSteps = 360;
  for (let i = 1; i <= maxSteps; i += 1) {
    const currentTime = startMs + stepMs * i;
    const propagation = propEciKm(entry.satrec, new Date(currentTime));
    if (!propagation) continue;
    const geo = eciToLngLatAlt(new Date(currentTime), propagation.position);
    const lat = geo.latitude;
    if (Math.abs(lat) < 0.05) {
      nextEquatorCache = {
        id: entry.id,
        timeMs: currentTime,
        longitude: ((geo.longitude + 540) % 360) - 180,
        computedAt: startMs,
      };
      return;
    }
    if (prevLat !== null && Math.sign(prevLat) !== Math.sign(lat)) {
      let low = prevTime;
      let high = currentTime;
      let lowLat = prevLat;
      for (let iter = 0; iter < 6; iter += 1) {
        const mid = (low + high) / 2;
        const midProp = propEciKm(entry.satrec, new Date(mid));
        if (!midProp) break;
        const midGeo = eciToLngLatAlt(new Date(mid), midProp.position);
        if (Math.sign(midGeo.latitude) === Math.sign(lowLat)) {
          low = mid;
          lowLat = midGeo.latitude;
        } else {
          high = mid;
        }
      }
      const midDate = new Date((low + high) / 2);
      const midProp = propEciKm(entry.satrec, midDate);
      if (midProp) {
        const midGeo = eciToLngLatAlt(midDate, midProp.position);
        nextEquatorCache = {
          id: entry.id,
          timeMs: midDate.getTime(),
          longitude: ((midGeo.longitude + 540) % 360) - 180,
          computedAt: startMs,
        };
      }
      return;
    }
    prevLat = lat;
    prevTime = currentTime;
  }
}

function handlePointer(event: PointerEvent): void {
  const rect = (earthScene.renderer.domElement as HTMLCanvasElement).getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  const picked = earthScene.pickSatellite(ndcX, ndcY);
  if (picked) {
    const name = satellites.get(picked.id)?.name ?? `NORAD ${picked.id}`;
    const focus = event.detail >= 2;
    const toast = focus ? `Focused on ${name}` : `Selected ${name}`;
    selectSatellite(picked.id, { focus, toast });
  }
}

function updateScene(deltaMs: number): void {
  if (playing) {
    simTimeMs += deltaMs * speedMultiplier;
  }
  const date = new Date(simTimeMs);
  earthScene.setSunDirectionFromDate(date);
  const gmst = gmstFromDate(date);
  earthScene.updateEarthOrientation(gmst);
  const list = Array.from(satellites.values());
  const total = list.length;
  if (total === 0) {
    earthScene.updateSatellites([]);
    earthScene.updateLabels([]);
    earthScene.updateTrails([]);
    earthScene.updateOrbits([]);
    orbitCache.clear();
    updateInfoPanel(null, date);
    return;
  }
  const toRender = Math.min(total, MAX_RENDERED);
  const now = performance.now();
  const propagateCount = Math.min(PROPAGATE_PER_FRAME, total);
  for (let batch = 0; batch < propagateCount; batch += 1) {
    const index = (propagateCursor + batch) % total;
    const sat = list[index];
    const propagation = propEciKm(sat.satrec, date);
    if (propagation) {
      sat.lastPositionKm = propagation.position;
      sat.lastVelocityKm = propagation.velocity;
      sat.lastUpdateMs = simTimeMs;
      if (trailsEnabled && sat.id === selectedId && now - lastTrailStamp > TRAIL_INTERVAL_MS) {
        pushTrailSample(sat.id, [
          propagation.position[0] * KM_TO_UNITS,
          propagation.position[1] * KM_TO_UNITS,
          propagation.position[2] * KM_TO_UNITS,
        ]);
      }
    }
  }
  if (trailsEnabled && now - lastTrailStamp > TRAIL_INTERVAL_MS) {
    lastTrailStamp = now;
  }
  propagateCursor = (propagateCursor + propagateCount) % Math.max(total, 1);

  const visible = list.slice(0, toRender);
  if (selectedId && !visible.some((sat) => sat.id === selectedId)) {
    const selected = satellites.get(selectedId);
    if (selected) {
      visible.push(selected);
      if (visible.length > MAX_RENDERED) {
        visible.shift();
      }
    }
  }

  const nowStates = visible.flatMap((sat) => {
    if (!sat.lastPositionKm) return [];
    const quaternion = computeOrientation(sat);
    return [
      {
        id: sat.id,
        position: [
          sat.lastPositionKm[0] * KM_TO_UNITS,
          sat.lastPositionKm[1] * KM_TO_UNITS,
          sat.lastPositionKm[2] * KM_TO_UNITS,
        ] as [number, number, number],
        color: computeColor(sat.id),
        scale: sat.id === selectedId ? 1.6 : 1,
        quaternion: quaternion ?? undefined,
      } satisfies SatelliteVisualState,
    ];
  });
  earthScene.updateSatellites(nowStates);

  const orbitStates: OrbitState[] = [];
  for (const sat of visible) {
    const positions = getOrbitPositions(sat, date);
    if (positions) {
      orbitStates.push({ id: sat.id, positions, color: computeColor(sat.id) });
    }
  }
  earthScene.updateOrbits(orbitStates);

  if (labelsEnabled && performance.now() - lastLabelRefresh > 500) {
    earthScene.updateLabels(updateLabels());
    lastLabelRefresh = performance.now();
  } else if (!labelsEnabled) {
    earthScene.updateLabels([]);
  }

  if (selectedId) {
    const selected = satellites.get(selectedId) ?? null;
    if (selected) {
      if (
        !nextEquatorCache ||
        nextEquatorCache.id !== selectedId ||
        Math.abs(nextEquatorCache.computedAt - simTimeMs) > 60_000
      ) {
        updateNextEquatorPass(selected, date);
      }
      updateInfoPanel(selected, date);
    } else {
      updateInfoPanel(null, date);
    }
  } else {
    updateInfoPanel(null, date);
  }

  const trailStates: TrailState[] = [];
  if (trailsEnabled && selectedId) {
    const trail = buildTrailState(selectedId);
    if (trail) trailStates.push(trail);
  } else {
    if (selectedId) removeTrail(selectedId);
  }
  earthScene.updateTrails(trailStates);
}

function animate(): void {
  const now = performance.now();
  const deltaMs = now - lastFrame;
  lastFrame = now;
  updateScene(deltaMs);
  earthScene.render();
  requestAnimationFrame(animate);
}

ui.playButton?.addEventListener('click', () => {
  playing = !playing;
  updatePlayButton();
});

ui.speedSelect?.addEventListener('change', () => {
  const value = Number(ui.speedSelect.value);
  speedMultiplier = Number.isFinite(value) ? value : 1;
});

ui.nowButton?.addEventListener('click', () => {
  simTimeMs = Date.now();
  updateTimeReadout();
});

ui.searchButton?.addEventListener('click', () => {
  performSearch();
});

ui.searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    performSearch();
  }
});

ui.sampleButton?.addEventListener('click', () => {
  loadSample();
});

ui.labelsToggle?.addEventListener('change', () => {
  labelsEnabled = !!ui.labelsToggle?.checked;
  if (!labelsEnabled) {
    earthScene.updateLabels([]);
  } else {
    lastLabelRefresh = 0;
    earthScene.updateLabels(updateLabels());
  }
});

ui.trailToggle?.addEventListener('change', () => {
  trailsEnabled = !!ui.trailToggle?.checked;
  if (!trailsEnabled) {
    trailHistories.clear();
    earthScene.updateTrails([]);
  } else {
    lastTrailStamp = 0;
  }
});

ui.focusButton?.addEventListener('click', () => {
  focusOnSelected(true);
});

ui.clearButton?.addEventListener('click', () => {
  clearSelection(true);
});

(earthScene.renderer.domElement as HTMLCanvasElement).addEventListener('pointerdown', handlePointer);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    clearSelection(false);
  }
});

updatePlayButton();
updateTimeReadout();
updateRenderStatus();
animate();
loadSample().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  showToast('Sample load failed at start.', true);
});

setInterval(updateTimeReadout, 1000);
