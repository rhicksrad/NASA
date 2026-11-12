import { isAbortError } from '../../api/worker';
import { getHourlyHighlight, type HourlyHighlight } from './hourlyHighlight';

const dateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

function formatCaptureDate(value?: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : dateFormatter.format(parsed);
}

function formatRefreshTime(hourStart: Date): string {
  const next = new Date(hourStart.getTime() + 60 * 60 * 1000);
  return `Refreshes at ${next.toISOString().slice(11, 16)} UTC`;
}

interface HighlightElements {
  frame: HTMLElement;
  title: HTMLElement | null;
  meta: HTMLElement | null;
  credit: HTMLElement | null;
  explorerLink: HTMLAnchorElement | null;
}

function renderHighlight(highlight: HourlyHighlight, elements: HighlightElements): void {
  const { item, assetUrl, query, page, timestamp } = highlight;
  const { frame, title, meta, credit, explorerLink } = elements;

  const img = document.createElement('img');
  img.src = assetUrl;
  img.alt = item.title || 'NASA mission image';
  img.decoding = 'async';
  const clearLoading = () => frame.classList.remove('loading');
  img.addEventListener('load', clearLoading, { once: true });
  img.addEventListener('error', clearLoading, { once: true });
  frame.replaceChildren(img);

  if (title) title.textContent = item.title || 'NASA mission image';

  if (meta) {
    const captured = formatCaptureDate(item.date_created);
    meta.textContent = [
      captured ? `Captured ${captured}` : null,
      `Curated from “${query}” search`,
      formatRefreshTime(timestamp),
    ]
      .filter(Boolean)
      .join(' • ');
  }

  if (credit) {
    credit.textContent = [item.photographer ? `Credit: ${item.photographer}` : null, 'Courtesy of NASA']
      .filter(Boolean)
      .join(' • ');
    credit.hidden = false;
  }

  if (explorerLink) {
    const params = new URLSearchParams({ preset: 'custom', q: query, page: String(page) });
    explorerLink.href = `#/images/explorer?${params.toString()}`;
  }
}

function renderFailure({ frame, title, meta, credit }: HighlightElements): void {
  const fallback = document.createElement('p');
  fallback.className = 'hero-hourly__status';
  fallback.textContent = 'The hourly highlight is unavailable right now.';
  frame.replaceChildren(fallback);
  frame.classList.remove('loading');
  if (title) title.textContent = 'Unable to load mission highlight';
  if (meta) meta.textContent = 'Please try again in a few minutes.';
  if (credit) credit.hidden = true;
}

/**
 * Wires up the landing view's hourly mission highlight.
 * Expects the home markup to already be in `host`; returns a cleanup that
 * cancels the in-flight lookup when the visitor navigates away.
 */
export function mountHome(host: HTMLElement): () => void {
  const frame = host.querySelector<HTMLElement>('#hourly-media');
  if (!frame) return () => undefined;

  const elements: HighlightElements = {
    frame,
    title: host.querySelector<HTMLElement>('#hourly-title'),
    meta: host.querySelector<HTMLElement>('#hourly-meta'),
    credit: host.querySelector<HTMLElement>('#hourly-credit'),
    explorerLink: host.querySelector<HTMLAnchorElement>('#hero-explorer-link'),
  };

  const controller = new AbortController();
  frame.classList.add('loading');

  getHourlyHighlight(new Date(), controller.signal)
    .then((highlight) => {
      if (!controller.signal.aborted) renderHighlight(highlight, elements);
    })
    .catch((error) => {
      if (controller.signal.aborted || isAbortError(error)) return;
      console.error('Hourly highlight failed to load', error);
      renderFailure(elements);
    });

  return () => controller.abort();
}
