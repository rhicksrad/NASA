import './styles/main.css';
import { getApod } from './api/fetch_apod';
import { initNeoSection } from './routes/neo';

function qs<T extends Element>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el as T;
}

function renderApod(container: HTMLElement, apod: any): void {
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

function friendlyError(e: unknown): string {
  if (e && typeof e === 'object' && 'status' in e && 'url' in e) {
    const he = e as { status: number; url: string };
    return `HTTP ${he.status} fetching ${he.url}`;
  }
  return 'Request failed';
}

async function init() {
  const apodImg = qs<HTMLDivElement>('#apod-image');
  const apodTitle = qs<HTMLHeadingElement>('#apod-title');
  const apodDate = qs<HTMLParagraphElement>('#apod-date');
  const apodExpl = qs<HTMLParagraphElement>('#apod-expl');

  const neoSummary = qs<HTMLParagraphElement>('#neo-summary');
  const neoList = qs<HTMLUListElement>('#neo-list');

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
    await initNeoSection(neoSummary, neoList);
  } catch (err) {
    neoSummary.textContent = `NEO sample failed to load. ${friendlyError(err)}`;
    console.error(err);
  } finally {
    neoSummary.classList.remove('loading');
  }
}

document.addEventListener('DOMContentLoaded', init);
