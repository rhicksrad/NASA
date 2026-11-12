/** Renders the TLE search result list in the Satellite 3D sidebar. */
import type { NormalizedTle } from '../../api/tle';
import { tleAgeDays } from './sgp4';

const MAX_RESULTS = 50;
const STALE_AFTER_DAYS = 7;

export function formatTleAge(days: number): string {
  if (days < 0.1) return '<0.1 day';
  if (days < 2) return `${days.toFixed(2)} days`;
  if (days < 10) return `${days.toFixed(1)} days`;
  return `${days.toFixed(0)} days`;
}

function statusLine(text: string): HTMLDivElement {
  const status = document.createElement('div');
  status.className = 'search-status';
  status.textContent = text;
  return status;
}

export interface SearchResultOptions {
  query: string;
  isLoaded: (id: number) => boolean;
  onPick: (item: NormalizedTle) => void;
}

export function renderSearchResults(
  container: HTMLElement,
  items: NormalizedTle[],
  { query, isLoaded, onPick }: SearchResultOptions,
): void {
  container.replaceChildren();
  if (!query) return;
  if (items.length === 0) {
    container.append(statusLine(`No results for “${query}”.`));
    return;
  }

  const shown = items.slice(0, MAX_RESULTS);
  container.append(
    statusLine(
      items.length > shown.length
        ? `Showing first ${shown.length} of ${items.length} results for “${query}”.`
        : `Showing ${shown.length} result${shown.length === 1 ? '' : 's'} for “${query}”.`,
    ),
  );

  const now = new Date();
  for (const item of shown) {
    const ageDays = Math.max(0, tleAgeDays(item.epoch, now));
    const loaded = isLoaded(item.id);

    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'result-item';
    entry.dataset.id = String(item.id);
    entry.classList.toggle('stale', ageDays > STALE_AFTER_DAYS);

    const name = document.createElement('div');
    name.className = 'result-name';
    name.textContent = `${item.name} · ${item.id}`;

    const meta = document.createElement('div');
    meta.className = 'result-meta';
    meta.textContent = [`Orbit data ${formatTleAge(ageDays)} old`, loaded ? 'in the scene' : ''].filter(Boolean).join(' · ');

    entry.append(name, meta);
    entry.addEventListener('click', () => onPick(item));
    container.append(entry);
  }
}
