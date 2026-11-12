/** Exoplanet Explorer: filter the NASA Exoplanet Archive and inspect individual worlds. */
import { queryExoplanetArchive, type TapRow } from '../../api/exoplanets';
import { isAbortError } from '../../api/worker';
import { byId, escapeHtml, stateArt } from '../../lib/dom';
import { initSiteNav } from '../../shell/nav';
import { massRadiusChart } from './massRadius';
import { planetArt } from './planetArt';
import { classifyPlanet } from './planetTypes';
import { EXO_PRESETS, type ExoPreset } from './presets';
import { buildQuery, FILTER_KEYS, type FilterKey, type Filters } from './query';
import {
  formatLightYears,
  formatNumber,
  formatTemperature,
  kelvinToFahrenheit,
  median,
  parsecsToLightYears,
  toCsv,
  toNumber,
} from './units';

initSiteNav();

interface Planet {
  name: string;
  host: string;
  rade: number | null;
  masse: number | null;
  /** Equilibrium temperature in kelvin. */
  eqt: number | null;
  period: number | null;
  distancePc: number | null;
  distanceLy: number | null;
  ra: number | null;
  dec: number | null;
  year: number | null;
}

type SortKey = Exclude<keyof Planet, 'distancePc'>;
interface SortState {
  key: SortKey | null;
  dir: 'asc' | 'desc';
}

const inputs = Object.fromEntries(
  FILTER_KEYS.map((key) => [key, byId<HTMLInputElement | HTMLSelectElement>(key)]),
) as Record<FilterKey, HTMLInputElement | HTMLSelectElement>;

const statusEl = byId('status');
const adqlEl = byId('adql');
const rowsEl = byId('rows');
const hintEl = byId('hint');
const examplesEl = byId('exampleButtons');
const massRadiusEl = byId('mrViz');
const massRadiusNote = byId('mrNote');
const selectedSummaryEl = byId('selectedSummary');
const sortButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-sort-key]')];

let loadedRows: Planet[] = [];
let visibleRows: Planet[] = [];
let sortState: SortState = { key: null, dir: 'asc' };
let selectedName = '';
let presetNote = '';
let activeQuery: AbortController | null = null;
let chartCompact = false;

// --- Filters ---------------------------------------------------------------

function readFilters(): Filters {
  return Object.fromEntries(FILTER_KEYS.map((key) => [key, inputs[key].value.trim()])) as Filters;
}

function writeFilters(values: Partial<Filters>): void {
  for (const key of FILTER_KEYS) inputs[key].value = values[key] ?? '';
}

function presetFilters(preset: ExoPreset): Partial<Filters> {
  const text = (value: number | null) => (value === null ? '' : String(value));
  const fahrenheit = (kelvin: number | null) => (kelvin === null ? '' : String(Math.round(kelvinToFahrenheit(kelvin))));
  return {
    yearMin: String(preset.yearMin),
    rMin: text(preset.radius[0]),
    rMax: text(preset.radius[1]),
    tMin: fahrenheit(preset.temperatureK[0]),
    tMax: fahrenheit(preset.temperatureK[1]),
  };
}

function syncUrl(): void {
  const params = new URLSearchParams(Object.entries(readFilters()).filter(([, value]) => value !== ''));
  const query = params.toString();
  history.replaceState(null, '', query ? `${location.pathname}?${query}` : location.pathname);
}

function flashStatus(text: string): void {
  statusEl.textContent = text;
  window.setTimeout(() => {
    if (statusEl.textContent === text) statusEl.textContent = '';
  }, 1200);
}

// --- Data --------------------------------------------------------------------

function toPlanet(row: TapRow): Planet | null {
  if (!row.pl_name || !row.hostname) return null;
  const distancePc = toNumber(row.distance_pc ?? row.sy_dist);
  return {
    name: String(row.pl_name),
    host: String(row.hostname),
    rade: toNumber(row.rade ?? row.pl_rade),
    masse: toNumber(row.masse ?? row.pl_masse),
    eqt: toNumber(row.eqt ?? row.pl_eqt),
    period: toNumber(row.period ?? row.pl_orbper),
    distancePc,
    distanceLy: parsecsToLightYears(distancePc),
    ra: toNumber(row.ra),
    dec: toNumber(row.dec),
    year: toNumber(row.disc_year),
  };
}

function showOffline(): void {
  statusEl.textContent = '';
  loadedRows = [];
  visibleRows = [];
  rowsEl.replaceChildren();
  for (const id of ['sumCount', 'sumR', 'sumT', 'sumDistLy', 'sumMass']) byId(id).textContent = '–';
  hintEl.textContent = 'No planets to list until the archive answers.';
  massRadiusNote.textContent = '';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => void runQuery());
  const state = stateArt('offline', 'The Exoplanet Archive did not answer. It is often slow for a minute or two and then recovers.');
  state.append(retry);
  massRadiusEl.replaceChildren(state);
  selectedSummaryEl.innerHTML = '<h2>No answer yet</h2><p>The filters are kept, so trying again asks for the same planets.</p>';
}

async function runQuery(): Promise<void> {
  syncUrl();
  const { adql, description } = buildQuery(readFilters());
  adqlEl.textContent = adql;

  // Only the most recent query may update the page.
  activeQuery?.abort();
  const controller = new AbortController();
  activeQuery = controller;

  const startedAt = performance.now();
  statusEl.textContent = 'Asking the archive…';
  let rows: TapRow[];
  try {
    rows = await queryExoplanetArchive(adql, controller.signal);
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) return;
    console.error('Exoplanet query failed', error);
    showOffline();
    return;
  }
  if (controller.signal.aborted) return;

  loadedRows = rows.map(toPlanet).filter((planet): planet is Planet => planet !== null);
  statusEl.textContent = `Answered in ${((performance.now() - startedAt) / 1000).toFixed(1)} s`;
  hintEl.textContent = presetNote ? `${presetNote.replace(/^Curated sample: /, '').replace(/^./, (c) => c.toUpperCase())} ${description}.` : `${description}.`;

  renderTable();
  renderSummary();
  // Prefer a planet that appears on the chart, so the page opens with one dot picked out.
  selectPlanet(
    loadedRows.find((planet) => planet.name === selectedName) ??
      visibleRows.find((planet) => planet.masse !== null && planet.rade !== null) ??
      visibleRows[0] ??
      null,
    { reveal: true },
  );
}

// --- Table -------------------------------------------------------------------

function compare(a: Planet, b: Planet, key: SortKey, direction: 1 | -1): number {
  const left = a[key];
  const right = b[key];
  // Missing values sink to the bottom regardless of direction.
  if (left === null || left === '') return right === null || right === '' ? 0 : 1;
  if (right === null || right === '') return -1;
  if (typeof left === 'string' || typeof right === 'string') {
    return String(left).localeCompare(String(right), undefined, { sensitivity: 'base' }) * direction;
  }
  return (left - right) * direction;
}

function renderTable(): void {
  const { key, dir } = sortState;
  visibleRows = key ? [...loadedRows].sort((a, b) => compare(a, b, key, dir === 'desc' ? -1 : 1)) : [...loadedRows];

  rowsEl.innerHTML = visibleRows
    .map(
      (planet, index) => `
<tr data-index="${index}" tabindex="0">
<td><button type="button" class="planet-name-btn" data-index="${index}">${escapeHtml(planet.name)}</button></td>
<td>${escapeHtml(planet.host)}</td>
<td class="num">${formatNumber(planet.rade)}</td>
<td class="num">${formatNumber(planet.masse)}</td>
<td class="num">${formatTemperature(planet.eqt)}</td>
<td class="num">${formatNumber(planet.period)}</td>
<td class="num">${formatLightYears(planet.distanceLy)}</td>
<td class="num">${planet.year ?? ''}</td>
</tr>`,
    )
    .join('');

  for (const button of sortButtons) {
    const header = button.closest('th');
    if (!header) continue;
    const active = sortState.key === button.dataset.sortKey;
    header.dataset.sortDir = active ? sortState.dir : 'none';
    header.setAttribute('aria-sort', !active ? 'none' : sortState.dir === 'asc' ? 'ascending' : 'descending');
  }
  markSelectedRow();
}

function markSelectedRow(): void {
  for (const row of rowsEl.querySelectorAll<HTMLTableRowElement>('tr[data-index]')) {
    row.classList.toggle('selected', visibleRows[Number(row.dataset.index)]?.name === selectedName);
  }
}

function renderSummary(): void {
  const present = (key: 'rade' | 'eqt' | 'masse' | 'distanceLy') =>
    loadedRows.map((planet) => planet[key]).filter((value): value is number => value !== null);
  byId('sumCount').textContent = loadedRows.length.toLocaleString('en-US');
  byId('sumR').textContent = formatNumber(median(present('rade')), 2, '–');
  const medianTemperature = median(present('eqt'));
  byId('sumT').textContent =
    medianTemperature === null ? '–' : Math.round(kelvinToFahrenheit(medianTemperature)).toLocaleString('en-US');
  byId('sumMass').textContent = String(present('masse').length);
  byId('sumDistLy').textContent = formatLightYears(median(present('distanceLy')));
}

// --- Selected planet ---------------------------------------------------------

function renderChart(): void {
  chartCompact = massRadiusEl.clientWidth > 0 && massRadiusEl.clientWidth < 520;
  massRadiusEl.replaceChildren(massRadiusChart(visibleRows, selectedName, chartCompact));
  const plotted = visibleRows.filter((planet) => planet.masse !== null && planet.rade !== null).length;
  massRadiusNote.textContent = plotted
    ? `${plotted.toLocaleString('en-US')} of ${visibleRows.length.toLocaleString('en-US')} planets here have both a measured mass and radius. Both axes are logarithmic; the crosses mark Earth, Neptune and Jupiter.`
    : 'None of these planets has both a measured mass and radius yet.';
}

function selectPlanet(planet: Planet | null, { reveal = false } = {}): void {
  selectedName = planet?.name ?? '';
  markSelectedRow();
  renderChart();

  if (!planet) {
    selectedSummaryEl.innerHTML = `
<h2>Pick a planet</h2>
<p>Choose a dot on the chart or a row in the table to see its star, orbit and climate.</p>`;
    return;
  }

  const type = classifyPlanet(planet);
  const distance = planet.distanceLy === null ? '–' : `${formatLightYears(planet.distanceLy)} light-years`;
  const fact = (term: string, value: string) => `<div><dt>${term}</dt><dd>${value}</dd></div>`;
  selectedSummaryEl.innerHTML = `
<div class="exo-planet__art">${planetArt(type.art)}</div>
<p class="exo-planet__kind">${escapeHtml(type.label)}</p>
<h2>${escapeHtml(planet.name)}</h2>
<p>${escapeHtml(type.description)}</p>
<dl class="exo-facts">
${fact('Star', escapeHtml(planet.host))}
${fact('Distance', distance)}
${fact('Radius', planet.rade === null ? '–' : `${formatNumber(planet.rade)} × Earth`)}
${fact('Mass', planet.masse === null ? 'Not measured' : `${formatNumber(planet.masse)} × Earth`)}
${fact('Temperature', planet.eqt === null ? '–' : `${formatTemperature(planet.eqt)} °F`)}
${fact('Year length', planet.period === null ? '–' : `${formatNumber(planet.period)} days`)}
${fact('Found', String(planet.year ?? '–'))}
${fact('Sky position', planet.ra === null || planet.dec === null ? '–' : `RA ${formatNumber(planet.ra, 2)}°, Dec ${formatNumber(planet.dec, 2)}°`)}
</dl>`;

  if (reveal) {
    // Scroll the table's own viewport, never the page.
    const row = rowsEl.querySelector<HTMLElement>('tr.selected');
    const viewport = byId('tblWrap');
    if (row) viewport.scrollTop = Math.max(0, row.offsetTop - viewport.clientHeight / 2);
  }
}

function planetFromEvent(event: Event, selector: string): Planet | null {
  const element = event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null;
  return element ? (visibleRows[Number(element.dataset.index)] ?? null) : null;
}

// --- Export ------------------------------------------------------------------

function exportCsv(): void {
  const header = ['pl_name', 'hostname', 'pl_rade', 'pl_masse', 'pl_eqt_f', 'pl_orbper', 'distance_ly', 'ra', 'dec', 'disc_year'];
  const round = (value: number | null, digits: number) => (value === null ? null : Number(value.toFixed(digits)));
  const body = visibleRows.map((planet) => [
    planet.name,
    planet.host,
    round(planet.rade, 2),
    round(planet.masse, 2),
    planet.eqt === null ? null : Math.round(kelvinToFahrenheit(planet.eqt)),
    round(planet.period, 2),
    round(planet.distanceLy, 2),
    round(planet.ra, 3),
    round(planet.dec, 3),
    planet.year,
  ]);
  const url = URL.createObjectURL(new Blob([toCsv([header, ...body])], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'exoplanets.csv';
  link.click();
  URL.revokeObjectURL(url);
  flashStatus('CSV saved');
}

// --- Wiring ------------------------------------------------------------------

function markPreset(active: HTMLElement | null): void {
  for (const chip of examplesEl.querySelectorAll('.exo-chip')) chip.toggleAttribute('aria-pressed', chip === active);
}

for (const preset of EXO_PRESETS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'exo-chip';
  button.textContent = preset.label;
  button.title = preset.description;
  button.addEventListener('click', () => {
    writeFilters(presetFilters(preset));
    presetNote = preset.description;
    markPreset(button);
    void runQuery();
  });
  examplesEl.append(button);
}

for (const button of sortButtons) {
  button.addEventListener('click', () => {
    const key = button.dataset.sortKey as SortKey;
    sortState = { key, dir: sortState.key === key && sortState.dir === 'asc' ? 'desc' : 'asc' };
    renderTable();
    // Dots are keyed by row position, so the chart follows the new order.
    renderChart();
  });
}

for (const input of Object.values(inputs)) {
  input.addEventListener('input', () => {
    presetNote = '';
    markPreset(null);
  });
  input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') void runQuery();
  });
}

byId('btnFetch').addEventListener('click', () => {
  presetNote = '';
  void runQuery();
});

byId('btnShare').addEventListener('click', async () => {
  syncUrl();
  try {
    await navigator.clipboard.writeText(location.href);
    flashStatus('Link copied');
  } catch {
    flashStatus('Copy the address bar link');
  }
});

byId('btnCSV').addEventListener('click', exportCsv);

// Redraw when the column crosses the width where the chart changes shape.
new ResizeObserver(() => {
  const compact = massRadiusEl.clientWidth > 0 && massRadiusEl.clientWidth < 520;
  if (compact !== chartCompact && visibleRows.length) renderChart();
}).observe(massRadiusEl);

massRadiusEl.addEventListener('click', (event) => {
  const planet = planetFromEvent(event, 'circle[data-index]');
  if (planet) selectPlanet(planet, { reveal: true });
});

rowsEl.addEventListener('click', (event) => {
  const planet = planetFromEvent(event, '[data-index]');
  if (planet) selectPlanet(planet);
});

rowsEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  // Leave native button activation alone; this handles focus on the row itself.
  if (event.target instanceof HTMLButtonElement) return;
  const planet = planetFromEvent(event, 'tr[data-index]');
  if (planet) {
    event.preventDefault();
    selectPlanet(planet);
  }
});

const initial = new URLSearchParams(location.search);
writeFilters(Object.fromEntries(FILTER_KEYS.map((key) => [key, initial.get(key) ?? ''])) as Filters);
void runQuery();
