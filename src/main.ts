import './styles/main.css';
import { getApod } from './api/fetch_apod';
import { getNeoBrowse } from './api/fetch_neo';
import { initNeoPage } from './routes/neo';
import type { Apod, NeoBrowse } from './types/nasa';

function renderApod(container: HTMLElement, apod: Apod): void {
  container.replaceChildren();
  if (apod.media_type === 'image') {
    const img = document.createElement('img');
    img.alt = apod.title || 'Astronomy Picture of the Day';
    img.loading = 'lazy';
    img.src = apod.hdurl || apod.url;
    container.appendChild(img);
  } else if (apod.media_type === 'video') {
    const frame = document.createElement('iframe');
    frame.src = apod.url;
    frame.title = apod.title || 'APOD Video';
    frame.setAttribute('allowfullscreen', 'true');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    container.appendChild(frame);
  } else {
    container.textContent = 'Unsupported media type';
  }
}

function renderNeoSummary(summaryEl: HTMLElement, listEl: HTMLElement, data: NeoBrowse): void {
  const total = data.page?.total_elements ?? 0;
  summaryEl.textContent = `Sample size: ${data.page?.size ?? 0} • Total known (reported): ${total}`;
  listEl.replaceChildren();

  for (const item of data.near_earth_objects.slice(0, 5)) {
    const li = document.createElement('li');
    li.textContent = item.name;
    listEl.appendChild(li);
  }

  if (!listEl.childElementCount) {
    const li = document.createElement('li');
    li.textContent = 'No objects returned in this sample.';
    listEl.appendChild(li);
  }
}

function friendlyError(e: unknown): string {
  if (e && typeof e === 'object' && 'status' in e && 'url' in e) {
    const he = e as { status: number; url: string };
    return `HTTP ${he.status} fetching ${he.url}`;
  }
  return 'Request failed';
}

async function initIndexPage(): Promise<void> {
  const apodImg = document.querySelector<HTMLDivElement>('#apod-image');
  if (!apodImg) {
    return;
  }

  const apodTitle = document.querySelector<HTMLHeadingElement>('#apod-title');
  const apodDate = document.querySelector<HTMLParagraphElement>('#apod-date');
  const apodExpl = document.querySelector<HTMLParagraphElement>('#apod-expl');
  const neoSummary = document.querySelector<HTMLParagraphElement>('#neo-summary');
  const neoList = document.querySelector<HTMLUListElement>('#neo-list');
  const neoLink = document.querySelector<HTMLAnchorElement>('#neo-link');

  if (!apodTitle || !apodDate || !apodExpl || !neoSummary || !neoList) {
    throw new Error('Missing index layout elements');
  }

  if (neoLink) {
    const base = import.meta.env.BASE_URL ?? '/';
    neoLink.href = `${base.replace(/\/+$/, '')}/neo.html`.replace('//neo.html', '/neo.html');
  }

  try {
    const apod = await getApod();
    apodTitle.textContent = apod.title;
    apodDate.textContent = apod.date;
    apodExpl.textContent = apod.explanation;
    apodImg.classList.remove('loading');
    renderApod(apodImg, apod);
  } catch (err) {
    apodImg.classList.remove('loading');
    apodImg.textContent = `APOD failed to load. ${friendlyError(err)}`;
    console.error(err);
  }

  try {
    const neo = await getNeoBrowse({ size: 5 });
    neoSummary.classList.remove('loading');
    renderNeoSummary(neoSummary, neoList, neo);
  } catch (err) {
    neoSummary.classList.remove('loading');
    neoSummary.textContent = `NEO sample failed to load. ${friendlyError(err)}`;
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initIndexPage().catch(err => console.error('Index init failed', err));

  if (document.querySelector('#neo-page')) {
    initNeoPage().catch(err => console.error('NEO page init failed', err));
  }
});
