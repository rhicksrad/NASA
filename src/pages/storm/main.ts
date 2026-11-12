/** CME Explorer: look up a DONKI coronal mass ejection and visualise its impact. */
import { fetchStormMarkdown, fetchStormReport, findCmes, type StormReport } from '../../api/donki';
import { searchImages } from '../../api/images';
import { isAbortError } from '../../api/worker';
import { byId, escapeHtml, stateArt } from '../../lib/dom';
import { renderMarkdown } from '../../lib/markdown';
import { initSiteNav } from '../../shell/nav';
import { auroraLatitude, formatHours, summarizeStorm, type StormSummary } from './analysis';
import { arrivalTimeline, auroraBands, kpGauge } from './charts';

initSiteNav();

const idInput = byId<HTMLInputElement>('id');
const idForm = byId<HTMLFormElement>('idForm');
const findForm = byId<HTMLFormElement>('findForm');
const startInput = byId<HTMLInputElement>('start');
const endInput = byId<HTMLInputElement>('end');
const results = byId<HTMLUListElement>('results');
const reportEl = byId('md');

let activeLoad: AbortController | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setQueryId(id: string): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('id', id);
  else url.searchParams.delete('id');
  history.replaceState(null, '', url);
}

function card(className: string, title: string | null, ...children: Array<Node | string>): HTMLElement {
  const element = document.createElement('div');
  element.className = `${className} card`;
  if (title) {
    const heading = document.createElement('h3');
    heading.className = 'card-title';
    heading.textContent = title;
    element.append(heading);
  }
  element.append(...children);
  return element;
}

function subtext(text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'subtext';
  element.textContent = text;
  return element;
}

function badgesCard(report: StormReport, summary: StormSummary): HTMLElement {
  const pills = [
    `<span class="pill">${escapeHtml(summary.speedBand.toUpperCase())}</span>`,
    `<span class="pill alt">${escapeHtml(summary.widthBand.toUpperCase())}</span>`,
    `<span class="pill kp">PEAK Kp ${summary.peakKp}</span>`,
    summary.forecastErrorMs !== null
      ? `<span class="pill delta">Δ forecast ${formatHours(summary.forecastErrorMs)} h</span>`
      : '',
    report.cme?.activeRegionNum ? `<span class="pill muted">AR ${escapeHtml(report.cme.activeRegionNum)}</span>` : '',
  ];
  const row = document.createElement('div');
  row.className = 'badges-row';
  row.innerHTML = pills.join('');
  const element = card('badges', null, row);
  if (report.cme?.sourceLocation) element.append(subtext(`Source: ${report.cme.sourceLocation}`));
  return element;
}

function timelineCard(summary: StormSummary): HTMLElement {
  if (!summary.events.length) return card('timeline', null);
  const element = card(
    'timeline',
    'Arrival & Impact Timeline (UTC)',
    arrivalTimeline(summary.events, reportEl.clientWidth - 32),
  );
  const metrics = document.createElement('div');
  metrics.className = 'metrics';
  metrics.innerHTML = [
    summary.forecastErrorMs !== null
      ? `|predicted−observed|: <strong>${formatHours(summary.forecastErrorMs)} h</strong>`
      : '',
    summary.shockToStormMs !== null ? `IPS→GST: <strong>${formatHours(summary.shockToStormMs)} h</strong>` : '',
  ]
    .filter(Boolean)
    .join(' &nbsp; ');
  element.append(metrics);
  return element;
}

function mediaCard(activityId: string, signal: AbortSignal): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'strip';
  strip.textContent = 'Loading…';

  const year = /^(\d{4})-\d{2}-\d{2}/.exec(activityId)?.[1];
  searchImages({ q: 'coronal mass ejection LASCO SDO', year_start: year, year_end: year }, { signal })
    .then(({ items }) => {
      const withPreview = items.filter((item) => item.thumb).slice(0, 8);
      if (!withPreview.length) {
        strip.textContent = 'No media found for this date window.';
        return;
      }
      strip.replaceChildren(
        ...withPreview.map((item) => {
          const link = document.createElement('a');
          link.href = `https://images.nasa.gov/details/${encodeURIComponent(item.nasa_id)}`;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          const img = document.createElement('img');
          img.loading = 'lazy';
          img.src = item.thumb;
          img.alt = item.title || 'NASA media';
          link.append(img);
          return link;
        }),
      );
    })
    .catch((error) => {
      if (isAbortError(error)) return;
      const failure = document.createElement('div');
      failure.className = 'error';
      failure.textContent = `Media search failed (${errorMessage(error)}).`;
      strip.replaceChildren(failure);
    });

  return card('media', 'Related Media', strip);
}

function showError(message: string): void {
  const paragraph = document.createElement('p');
  paragraph.className = 'error';
  paragraph.textContent = message;
  reportEl.replaceChildren(paragraph);
}

async function loadById(activityId: string): Promise<void> {
  if (!activityId) {
    showError('Enter an Activity ID.');
    return;
  }

  // A newer lookup supersedes whatever is still in flight.
  activeLoad?.abort();
  const controller = new AbortController();
  activeLoad = controller;
  const { signal } = controller;

  reportEl.textContent = 'Loading…';
  try {
    const [markdown, report] = await Promise.all([
      fetchStormMarkdown(activityId, signal),
      fetchStormReport(activityId, signal),
    ]);
    if (signal.aborted) return;

    const summary = summarizeStorm(report);
    reportEl.innerHTML = renderMarkdown(markdown);

    const headline = document.createElement('div');
    headline.className = 'badass-row';
    headline.append(
      badgesCard(report, summary),
      card('kp', 'Kp Gauge', kpGauge(summary.peakKp)),
      timelineCard(summary),
    );

    const context = document.createElement('div');
    context.className = 'badass-row';
    context.append(
      card(
        'aurora',
        'Aurora Visibility Bands (rule-of-thumb)',
        subtext(
          `Peak Kp ${summary.peakKp} → aurora potentially visible down to ~${auroraLatitude(summary.peakKp)}° geomagnetic lat.`,
        ),
        auroraBands(summary.peakKp),
      ),
      mediaCard(activityId, signal),
    );

    const panel = document.createElement('section');
    panel.className = 'badass';
    panel.append(headline, context);
    reportEl.append(panel);

    setQueryId(activityId);
  } catch (error) {
    if (signal.aborted) return;
    reportEl.replaceChildren(stateArt('offline', `The report could not be loaded (${errorMessage(error)}).`));
  }
}

function selectActivity(activityId: string): void {
  idInput.value = activityId;
  void loadById(activityId);
}

idForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void loadById(idInput.value.trim());
});

findForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const start = startInput.value;
  const end = endInput.value;
  if (!start || !end) return;

  const status = (text: string, className = '') => {
    const item = document.createElement('li');
    item.className = className;
    item.textContent = text;
    results.replaceChildren(item);
  };

  status('Searching…');
  try {
    const items = await findCmes(start, end);
    if (!items.length) {
      status('No CMEs found in range.');
      return;
    }
    results.replaceChildren(
      ...items.map((item) => {
        const link = document.createElement('a');
        link.href = `?id=${encodeURIComponent(item.activityID)}`;
        link.textContent = item.activityID;
        link.addEventListener('click', (clickEvent) => {
          clickEvent.preventDefault();
          selectActivity(item.activityID);
        });
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = [item.startTime, item.note?.slice(0, 80)].filter(Boolean).join(' — ');
        const entry = document.createElement('li');
        entry.append(link, meta);
        return entry;
      }),
    );
  } catch (error) {
    status(`Search failed (${errorMessage(error)})`, 'error');
  }
});

for (const button of document.querySelectorAll<HTMLElement>('[data-activity-id]')) {
  button.addEventListener('click', () => {
    const activityId = button.dataset.activityId;
    if (activityId) selectActivity(activityId);
  });
}

const initialId = new URLSearchParams(window.location.search).get('id');
if (initialId) selectActivity(initialId);
