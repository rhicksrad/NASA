/** Solar storms: pick a DONKI coronal mass ejection and read what it did on the way to Earth. */
import { fetchStormReport, findCmes, type CmeListing, type StormReport } from '../../api/donki';
import { searchImages } from '../../api/images';
import { isAbortError } from '../../api/worker';
import { byId, stateArt } from '../../lib/dom';
import { initSiteNav } from '../../shell/nav';
import {
  auroraLatitude,
  formatHours,
  stormScale,
  summarizeStorm,
  transitHours,
  type StormSummary,
} from './analysis';
import { arrivalTimeline, auroraMap, formatClock, formatDay } from './charts';

initSiteNav();

const idInput = byId<HTMLInputElement>('id');
const idForm = byId<HTMLFormElement>('idForm');
const findForm = byId<HTMLFormElement>('findForm');
const startInput = byId<HTMLInputElement>('start');
const endInput = byId<HTMLInputElement>('end');
const results = byId<HTMLUListElement>('results');
const recent = byId<HTMLUListElement>('recent');
const reportEl = byId('md');

const RECENT_SHOWN = 6;

let activeLoad: AbortController | null = null;
let activeId = '';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isoDay(offsetDays = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function setQueryId(id: string): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('id', id);
  else url.searchParams.delete('id');
  history.replaceState(null, '', url);
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

/** "2024-05-10T07:12:00-CME-001" starts with the moment the eruption was first seen. */
function idTime(activityId: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(activityId);
  if (!match) return null;
  const date = new Date(`${match[1]}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const fullDay = (date: Date) => `${formatDay(date)} ${date.getUTCFullYear()}`;
const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// --- Report ------------------------------------------------------------------

function figure(value: string, unit: string, caption: string): HTMLElement {
  return el(
    'div',
    'storm-figure',
    el('div', 'storm-figure__value', value, el('span', '', unit)),
    el('p', 'storm-figure__caption', caption),
  );
}

function figures(summary: StormSummary): HTMLElement {
  const row = el('div', 'storm-figures');

  if (summary.speed !== null) {
    const hours = transitHours(summary.speed);
    const trip = hours >= 48 ? `${(hours / 24).toFixed(1)} days` : `${Math.round(hours)} hours`;
    row.append(
      figure(
        Math.round(summary.speed).toLocaleString('en-US'),
        'km/s',
        `${sentenceCase(summary.speedBand)}. Holding that speed, the Sun to Earth distance takes ${trip}.`,
      ),
    );
  } else {
    row.append(figure('–', '', 'No speed was measured for this eruption.'));
  }

  if (summary.width !== null) {
    row.append(
      figure(
        String(Math.round(summary.width)),
        '° wide',
        `${sentenceCase(summary.widthBand)}. The wider the cloud, the more of the solar system it sweeps.`,
      ),
    );
  }

  if (summary.peakKp > 0) {
    const scale = stormScale(summary.peakKp);
    row.append(
      figure(
        String(Number(summary.peakKp.toFixed(1))),
        'peak Kp',
        `${scale ? `A ${scale} geomagnetic storm` : 'Unsettled, below storm level'}. Aurora possible to about ${auroraLatitude(summary.peakKp)}° magnetic latitude.`,
      ),
    );
  } else if (summary.forecastKp !== null) {
    row.append(
      figure(
        String(summary.forecastKp),
        'forecast Kp',
        'What the models expected at Earth. No geomagnetic storm is linked to this eruption in the catalogue.',
      ),
    );
  } else {
    row.append(figure('0', 'storms', 'No geomagnetic storm at Earth is linked to this eruption.'));
  }
  return row;
}

function section(className: string, title: string, ...children: Array<Node | string>): HTMLElement {
  return el('section', `storm-section ${className}`, el('h2', '', title), ...children);
}

function timelineSection(summary: StormSummary): HTMLElement | null {
  const hasArrival = summary.events.some((event) => event.kind !== 'launch');
  if (!hasArrival) return null;

  const notes: string[] = [];
  if (summary.forecastErrorMs !== null) {
    notes.push(`The closest model run missed the real arrival by ${formatHours(summary.forecastErrorMs)} hours.`);
  }
  if (summary.shockToStormMs !== null && summary.shockToStormMs >= 0) {
    notes.push(`The geomagnetic storm began ${formatHours(summary.shockToStormMs)} hours after the shock.`);
  }
  if (summary.otherArrivals.length) {
    const list = summary.otherArrivals
      .slice(0, 5)
      .map(({ label, t }) => `${label} (${formatDay(t)}, ${formatClock(t)})`)
      .join(', ');
    notes.push(`Elsewhere the models had it reaching ${list}.`);
  }

  const chart = el('div', 'storm-chart');
  const draw = () => chart.replaceChildren(arrivalTimeline(summary.events, chart.clientWidth || reportEl.clientWidth));
  // The chart is laid out in real pixels so its labels stay legible; redraw when the column changes width.
  let lastWidth = 0;
  new ResizeObserver(() => {
    if (!chart.isConnected || Math.abs(chart.clientWidth - lastWidth) < 24) return;
    lastWidth = chart.clientWidth;
    draw();
  }).observe(chart);
  chart.append(arrivalTimeline(summary.events, reportEl.clientWidth));

  const body = el('p', 'storm-section__note', notes.join(' ') || 'All times are UTC.');
  return section('timeline', 'The crossing', chart, body);
}

function auroraSection(summary: StormSummary): HTMLElement | null {
  if (summary.peakKp <= 0) return null;
  const latitude = auroraLatitude(summary.peakKp);
  return section(
    'aurora',
    'How far the aurora could reach',
    el('div', 'storm-chart', auroraMap(summary.peakKp)),
    el(
      'p',
      'storm-section__note',
      `At Kp ${Number(summary.peakKp.toFixed(1))} the auroral zones widen to about ${latitude}° magnetic latitude. ` +
        'They are centred on the magnetic poles, not the geographic ones, so the northern zone reaches furthest south over North America. A rule of thumb, not a forecast.',
    ),
  );
}

function mediaSection(year: string, signal: AbortSignal): HTMLElement {
  const strip = el('div', 'strip');
  const block = section('media', `From NASA’s image archive, ${year}`, strip);
  block.hidden = true;

  searchImages({ q: 'coronal mass ejection LASCO SDO', year_start: year, year_end: year }, { signal })
    .then(({ items }) => {
      const withPreview = items.filter((item) => item.thumb).slice(0, 8);
      if (!withPreview.length) return;
      strip.replaceChildren(
        ...withPreview.map((item) => {
          const link = document.createElement('a');
          link.href = `https://images.nasa.gov/details/${encodeURIComponent(item.nasa_id)}`;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.title = item.title || '';
          const img = document.createElement('img');
          img.loading = 'lazy';
          img.src = item.thumb;
          img.alt = item.title || 'NASA media';
          link.append(img);
          return link;
        }),
      );
      block.hidden = false;
    })
    .catch((error) => {
      // The archive strip is an extra; the report stands without it.
      if (!isAbortError(error)) console.warn('Storm media search failed', error);
    });

  return block;
}

function renderReport(activityId: string, report: StormReport, signal: AbortSignal): void {
  const summary = summarizeStorm(report);
  const when = summary.launch ?? idTime(activityId);
  const cme = report.cme ?? {};

  const origin: string[] = [];
  if (cme.activeRegionNum) origin.push(`active region ${cme.activeRegionNum}`);
  if (cme.sourceLocation) origin.push(`${cme.sourceLocation} on the solar disc`);
  const instruments = (cme.instruments ?? []).map((entry) => entry.displayName).filter(Boolean);

  const head = el(
    'header',
    'storm-head',
    el('p', 'storm-head__kicker', 'Coronal mass ejection'),
    el('h1', '', when ? fullDay(when) : activityId, ...(when ? [el('span', '', `${formatClock(when)} UTC`)] : [])),
  );
  const facts = [
    origin.length ? `From ${origin.join(', ')}.` : 'No source region was identified on the disc.',
    instruments.length ? `Seen by ${instruments.join(', ')}.` : '',
  ].filter(Boolean);
  head.append(el('p', 'storm-head__facts', facts.join(' ')));

  const parts: Array<HTMLElement | null> = [head, figures(summary)];
  if (cme.note) parts.push(el('p', 'storm-note', cme.note));
  parts.push(timelineSection(summary), auroraSection(summary));
  parts.push(mediaSection(String((when ?? new Date()).getUTCFullYear()), signal));

  const foot = el('p', 'storm-foot', `DONKI activity ${activityId}. `);
  if (cme.link && /^https?:\/\//.test(cme.link)) {
    const link = el('a', '', 'Open the catalogue record');
    link.href = cme.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    foot.append(link, '.');
  }
  parts.push(foot);

  reportEl.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null));
}

function markActive(): void {
  for (const button of document.querySelectorAll<HTMLElement>('[data-activity-id]')) {
    button.toggleAttribute('aria-current', button.dataset.activityId === activeId);
  }
}

async function loadById(activityId: string, { reveal = false } = {}): Promise<void> {
  if (!activityId) return;

  // A newer lookup supersedes whatever is still in flight.
  activeLoad?.abort();
  const controller = new AbortController();
  activeLoad = controller;
  const { signal } = controller;

  activeId = activityId;
  markActive();
  reportEl.classList.add('is-loading');
  if (!reportEl.childElementCount) reportEl.replaceChildren(el('p', 'storm-loading', 'Fetching the report.'));
  try {
    const report = await fetchStormReport(activityId, signal);
    if (signal.aborted) return;
    renderReport(activityId, report, signal);
    setQueryId(activityId);
    if (reveal && reportEl.getBoundingClientRect().top < 0) reportEl.scrollIntoView({ block: 'start' });
  } catch (error) {
    if (signal.aborted) return;
    reportEl.replaceChildren(stateArt('offline', `The report could not be loaded (${errorMessage(error)}).`));
  } finally {
    if (activeLoad === controller) reportEl.classList.remove('is-loading');
  }
}

function selectActivity(activityId: string): void {
  idInput.value = activityId;
  void loadById(activityId, { reveal: true });
}

// --- Index -------------------------------------------------------------------

function firstSentence(text: string | undefined, limit = 110): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'No description yet.';
  const sentence = /^.*?[.!?](?=\s|$)/.exec(clean)?.[0] ?? clean;
  return sentence.length > limit ? `${sentence.slice(0, limit).replace(/\s+\S*$/, '')}…` : sentence;
}

function listingButton(item: CmeListing, withYear: boolean): HTMLLIElement {
  const when = idTime(item.activityID);
  const button = el(
    'button',
    '',
    el(
      'span',
      'storm-list__when',
      when ? `${withYear ? fullDay(when) : formatDay(when)}, ${formatClock(when)}` : item.activityID,
    ),
    el('span', 'storm-list__what', firstSentence(item.note)),
  );
  button.type = 'button';
  button.dataset.activityId = item.activityID;
  button.addEventListener('click', () => selectActivity(item.activityID));
  return el('li', '', button);
}

function listNote(list: HTMLElement, text: string): void {
  list.replaceChildren(el('li', 'storm-list__note', text));
}

function renderListings(list: HTMLElement, items: CmeListing[], withYear: boolean): void {
  const newestFirst = [...items].sort((a, b) => b.activityID.localeCompare(a.activityID));
  const rows = newestFirst.map((item) => listingButton(item, withYear));
  if (rows.length > RECENT_SHOWN) {
    const extra = rows.slice(RECENT_SHOWN);
    for (const row of extra) row.hidden = true;
    const more = el('button', 'storm-list__more', `Show all ${rows.length}`);
    more.type = 'button';
    more.addEventListener('click', () => {
      for (const row of extra) row.hidden = false;
      more.parentElement?.remove();
    });
    rows.push(el('li', 'storm-list__note', more));
  }
  list.replaceChildren(...rows);
  markActive();
}

idForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const id = idInput.value.trim();
  if (id) void loadById(id, { reveal: true });
});

findForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const start = startInput.value;
  const end = endInput.value;
  if (!start || !end) return;

  listNote(results, 'Searching.');
  try {
    const items = await findCmes(start, end);
    if (!items.length) listNote(results, 'No eruptions were catalogued between those dates.');
    else renderListings(results, items, true);
  } catch (error) {
    listNote(results, `The search failed (${errorMessage(error)}).`);
  }
});

for (const button of document.querySelectorAll<HTMLElement>('[data-activity-id]')) {
  button.addEventListener('click', () => {
    const activityId = button.dataset.activityId;
    if (activityId) selectActivity(activityId);
  });
}

startInput.value = isoDay(-30);
endInput.value = isoDay(0);

const initialId = new URLSearchParams(window.location.search).get('id');
if (initialId) {
  idInput.value = initialId;
  void loadById(initialId);
}

// The past week fills the index, and its newest eruption opens when the address names none.
findCmes(isoDay(-7), isoDay(0))
  .then((items) => {
    if (!items.length) {
      listNote(recent, 'Nothing has been catalogued in the past seven days.');
      return;
    }
    renderListings(recent, items, false);
    if (!initialId && !activeId) {
      const latest = [...items].sort((a, b) => b.activityID.localeCompare(a.activityID))[0];
      void loadById(latest.activityID);
    }
  })
  .catch((error) => {
    listNote(recent, `This week’s list could not be loaded (${errorMessage(error)}).`);
    if (!initialId && !activeId) void loadById('2024-05-10T07:12:00-CME-001');
  });
