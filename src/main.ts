import './styles/main.css';
import { getHourlyHighlight, type HourlyHighlight } from './lib/hourlyHighlight';
import { initRouter } from './routes/index';
import { initNeoPage } from './routes/neo';

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

function formatCaptureDate(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;
  return dateFormatter.format(parsed);
}

function formatRefreshTime(timestamp: Date): string {
  const next = new Date(Date.UTC(timestamp.getUTCFullYear(), timestamp.getUTCMonth(), timestamp.getUTCDate(), timestamp.getUTCHours() + 1));
  return `Refreshes at ${next.toISOString().slice(11, 16)} UTC`;
}

function renderHighlight(
  highlight: HourlyHighlight,
  now: Date,
  elements: {
    frame: HTMLElement;
    title?: HTMLElement | null;
    meta?: HTMLElement | null;
    credit?: HTMLElement | null;
    explorerLink?: HTMLAnchorElement | null;
  },
): void {
  const { item, assetUrl, query, page, timestamp } = highlight;
  const { frame, title, meta, credit, explorerLink } = elements;

  frame.replaceChildren();
  const img = document.createElement('img');
  img.src = assetUrl;
  img.alt = item.title || 'NASA mission image';
  img.loading = 'lazy';
  frame.appendChild(img);

  if (title) {
    title.textContent = item.title || 'NASA mission image';
  }

  if (meta) {
    const parts: string[] = [];
    const formattedDate = formatCaptureDate(item.date_created);
    if (formattedDate) {
      parts.push(`Captured ${formattedDate}`);
    }
    parts.push(`Curated from “${query}” search`);
    const baseTime = timestamp ?? now;
    parts.push(formatRefreshTime(baseTime));
    meta.textContent = parts.join(' • ');
  }

  if (credit) {
    const credits: string[] = [];
    if (item.photographer) {
      credits.push(`Credit: ${item.photographer}`);
    }
    credits.push('Courtesy of NASA');
    credit.textContent = credits.join(' • ');
    credit.hidden = credits.length === 0;
  }

  if (explorerLink) {
    const params = new URLSearchParams();
    params.set('preset', 'custom');
    params.set('q', query);
    params.set('page', String(page));
    explorerLink.href = `#/images/explorer?${params.toString()}`;
  }
}

async function initIndexPage(): Promise<void> {
  const frame = document.querySelector<HTMLElement>('#hourly-media');
  if (!frame) {
    return;
  }

  frame.classList.add('loading');

  const title = document.querySelector<HTMLElement>('#hourly-title');
  const meta = document.querySelector<HTMLElement>('#hourly-meta');
  const credit = document.querySelector<HTMLElement>('#hourly-credit');
  const explorerLink = document.querySelector<HTMLAnchorElement>('#hero-explorer-link');
  const now = new Date();

  try {
    const highlight = await getHourlyHighlight(now);
    renderHighlight(highlight, now, { frame, title, meta, credit, explorerLink });
  } catch (err) {
    console.error('Hourly highlight failed to load', err);
    frame.replaceChildren();
    const fallback = document.createElement('p');
    fallback.className = 'hero-hourly__status';
    fallback.textContent = 'The hourly highlight is unavailable right now.';
    frame.appendChild(fallback);
    if (title) {
      title.textContent = 'Unable to load mission highlight';
    }
    if (meta) {
      meta.textContent = 'Please try again in a few minutes.';
    }
    if (credit) {
      credit.hidden = true;
    }
  } finally {
    frame.classList.remove('loading');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initRouter();
  initIndexPage().catch(err => console.error('Index init failed', err));

  if (document.querySelector('#neo-page')) {
    initNeoPage().catch(err => console.error('NEO page init failed', err));
  }
});
