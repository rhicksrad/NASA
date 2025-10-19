import './styles/main.css';
import { getHourlyHighlight, type HourlyHighlight } from './lib/hourlyHighlight';
import { initRouter } from './routes/index';
import { initNeoPage } from './routes/neo';
import navImagesIcon from './assets/icons/nav-images-explorer.svg?raw';
import navEpicIcon from './assets/icons/nav-epic-earth.svg?raw';
import navNeoIcon from './assets/icons/nav-neo3d.svg?raw';
import navCmeIcon from './assets/icons/nav-cme.svg?raw';
import navEonetIcon from './assets/icons/nav-eonet.svg?raw';
import navExoIcon from './assets/icons/nav-exoplanet.svg?raw';
import navMarsIcon from './assets/icons/nav-mars.svg?raw';

const NAV_ICONS = new Map<string, string>([
  ['nav-images-explorer', navImagesIcon],
  ['nav-epic', navEpicIcon],
  ['nav-neo3d', navNeoIcon],
  ['nav-storm', navCmeIcon],
  ['nav-events', navEonetIcon],
  ['nav-exo', navExoIcon],
  ['nav-mars', navMarsIcon],
]);

function injectNavigationIcons(): void {
  const nav = document.querySelector('.primary-nav');
  if (!nav) return;
  NAV_ICONS.forEach((svg, id) => {
    const anchor = nav.querySelector<HTMLAnchorElement>(`#${CSS.escape(id)}`);
    if (!anchor || anchor.querySelector('.primary-nav__icon')) {
      return;
    }
    const wrapper = document.createElement('span');
    wrapper.className = 'primary-nav__icon';
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.innerHTML = svg;
    const svgEl = wrapper.querySelector('svg');
    if (svgEl) {
      svgEl.setAttribute('focusable', 'false');
      svgEl.setAttribute('aria-hidden', 'true');
    }
    anchor.prepend(wrapper);
  });
}

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
  injectNavigationIcons();
  initRouter();
  initIndexPage().catch(err => console.error('Index init failed', err));

  if (document.querySelector('#neo-page')) {
    initNeoPage().catch(err => console.error('NEO page init failed', err));
  }
});
