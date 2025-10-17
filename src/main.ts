import './styles/main.css';
import { getApod } from './api/fetch_apod';
import { getNeoBrowse } from './api/fetch_neo';
import { HttpError } from './api/nasaClient';
import { renderApod } from './visuals/apod';
import { renderNeoSummary } from './visuals/neo';

function qs<T extends Element>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el as T;
}

function friendlyError(e: unknown): string {
  if (e instanceof HttpError) {
    const base = `HTTP ${e.status} fetching ${e.url}`;
    if (typeof e.body === 'string' && e.body.trim().length > 0) return `${base}: ${e.body}`;
    if (e.body && typeof e.body === 'object') {
      const maybeMsg =
        // NASA errors usually nest a `msg` or `message` property.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((e.body as any).msg as string | undefined) || ((e.body as any).message as string | undefined);
      if (maybeMsg) return `${base}: ${maybeMsg}`;
    }
    return base;
  }
  if (e instanceof Error && e.message) return e.message;
  return 'Request failed';
}

async function init() {
  const apodImg = qs<HTMLDivElement>('#apod-image');
  const apodTitle = qs<HTMLHeadingElement>('#apod-title');
  const apodDate = qs<HTMLParagraphElement>('#apod-date');
  const apodExpl = qs<HTMLParagraphElement>('#apod-expl');

  const neoSummary = qs<HTMLParagraphElement>('#neo-summary');
  const neoList = qs<HTMLUListElement>('#neo-list');

  // APOD
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

  // NEO
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

document.addEventListener('DOMContentLoaded', init);
