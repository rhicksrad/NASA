import './styles/main.css';
import { getApod } from './api/fetch_apod';
import { getNeoBrowse } from './api/fetch_neo';
import { renderApod } from './visuals/apod';
import { renderNeoSummary } from './visuals/neo';

function qs<T extends Element>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el as T;
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
    apodImg.textContent = `APOD failed to load`;
    console.error(err);
  }

  // NEO
  try {
    const neo = await getNeoBrowse({ size: 5 });
    neoSummary.classList.remove('loading');
    renderNeoSummary(neoSummary, neoList, neo);
  } catch (err) {
    neoSummary.classList.remove('loading');
    neoSummary.textContent = 'NEO sample failed to load';
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', init);
