import './styles/main.css';
import { getApodRobust } from './api/fetch_apod';
import { tryNeoBrowse } from './api/nasaClient';
import { initNeoPage } from './routes/neo';
import type { Apod, NeoBrowse } from './types/nasa';

async function loadApod(container: HTMLElement) {
  try {
    const apod = await getApodRobust();
    renderApod(container, apod);
  } catch (e) {
    console.error(e);
    container.textContent = 'APOD failed to load.';
  } finally {
    container.classList.remove('loading');
  }
}

function renderApod(container: HTMLElement, apod: Apod): void {
  container.replaceChildren();
  const title = document.createElement('h3');
  title.textContent = apod.title;
  container.appendChild(title);

  if (apod.media_type === 'image') {
    const img = document.createElement('img');
    img.src = apod.hdurl || apod.url;
    img.alt = apod.title;
    img.loading = 'lazy';
    container.appendChild(img);
  } else if (apod.media_type === 'video') {
    if (apod.thumbnail_url) {
      const a = document.createElement('a');
      a.href = apod.url;
      a.target = '_blank';
      a.rel = 'noopener';
      const thumb = document.createElement('img');
      thumb.src = apod.thumbnail_url;
      thumb.alt = `${apod.title} (video thumbnail)`;
      thumb.loading = 'lazy';
      a.appendChild(thumb);
      container.appendChild(a);
    } else {
      const frame = document.createElement('iframe');
      frame.src = apod.url;
      frame.allowFullscreen = true;
      frame.title = apod.title;
      frame.sandbox = 'allow-scripts allow-same-origin allow-popups';
      frame.referrerPolicy = 'no-referrer';
      container.appendChild(frame);
    }
  }

  const desc = document.createElement('p');
  desc.textContent = apod.explanation;
  container.appendChild(desc);
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
  const apodContainer = document.querySelector<HTMLDivElement>('#apod-image');
  if (!apodContainer) {
    return;
  }

  const neoSummary = document.querySelector<HTMLParagraphElement>('#neo-summary');
  const neoList = document.querySelector<HTMLUListElement>('#neo-list');
  const neoLink = document.querySelector<HTMLAnchorElement>('#neo-link');

  if (!neoSummary || !neoList) {
    throw new Error('Missing index layout elements');
  }

  if (neoLink) {
    const base = import.meta.env.BASE_URL ?? '/';
    neoLink.href = `${base.replace(/\/+$/, '')}/neo.html`.replace('//neo.html', '/neo.html');
  }

  await loadApod(apodContainer);

  try {
    const neo = await tryNeoBrowse(5);
    neoSummary.classList.remove('loading');
    if (!neo) {
      neoSummary.textContent = 'NEO sample unavailable.';
      neoList.replaceChildren();
      neoList.hidden = true;
      return;
    }
    neoList.hidden = false;
    renderNeoSummary(neoSummary, neoList, neo);
  } catch (err) {
    neoSummary.classList.remove('loading');
    neoList.hidden = true;
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
