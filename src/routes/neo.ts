import '../styles/neo.css';
import { getNeoFeed } from '../api/fetch_neo';
import { flattenFeed, type NeoFlat } from '../utils/neo';
import { renderNeoTimeline } from '../visuals/neo_timeline';
import { renderNeoHistogram } from '../visuals/neo_histogram';

const PAGE_SIZE = 20;

function el<T extends Element>(sel: string): T {
  const n = document.querySelector(sel);
  if (!n) throw new Error(`Missing ${sel}`);
  return n as T;
}

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function applyFilters(items: NeoFlat[], hazardOnly: boolean): NeoFlat[] {
  return hazardOnly ? items.filter(d => d.is_hazardous) : items;
}

function sortItems(items: NeoFlat[], mode: string): NeoFlat[] {
  const c = [...items];
  switch (mode) {
    case 'miss_ld':
      return c.sort((a, b) => (a.miss_ld ?? 1e9) - (b.miss_ld ?? 1e9));
    case 'vel_kps':
      return c.sort((a, b) => (b.vel_kps ?? 0) - (a.vel_kps ?? 0));
    case 'dia_km':
      return c.sort((a, b) => (b.dia_km_max ?? 0) - (a.dia_km_max ?? 0));
    default:
      return c.sort((a, b) => a.date.localeCompare(b.date));
  }
}

function renderList(listEl: HTMLUListElement, items: NeoFlat[], page: number) {
  listEl.replaceChildren();
  const start = page * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);
  if (!slice.length) {
    const li = document.createElement('li');
    li.textContent = 'No objects match the current filters.';
    listEl.appendChild(li);
    return;
  }
  for (const d of slice) {
    const li = document.createElement('li');
    const miss = d.miss_ld != null ? `${d.miss_ld.toFixed(2)} LD` : '—';
    const vel = d.vel_kps != null ? `${d.vel_kps.toFixed(2)} km/s` : '—';
    const dia = d.dia_km_max != null ? `${d.dia_km_max.toFixed(2)} km` : '—';
    li.textContent = `${d.date} • ${d.name} • miss ${miss} • v ${vel} • dia ${dia}${d.is_hazardous ? ' • hazardous' : ''}`;
    listEl.appendChild(li);
  }
}

export async function initNeoPage() {
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 86400_000);

  const startInput = el<HTMLInputElement>('#neo-start');
  const endInput = el<HTMLInputElement>('#neo-end');
  startInput.value = formatDate(start);
  endInput.value = formatDate(end);

  const hazardInput = el<HTMLInputElement>('#neo-hazard');
  const sortSelect = el<HTMLSelectElement>('#neo-sort');
  const loadBtn = el<HTMLButtonElement>('#neo-load');
  const listEl = el<HTMLUListElement>('#neo-list');
  const pagerInfo = el<HTMLSpanElement>('#neo-page-info');
  const prevBtn = el<HTMLButtonElement>('#neo-prev');
  const nextBtn = el<HTMLButtonElement>('#neo-next');

  const timelineEl = el<HTMLDivElement>('#neo-timeline');
  const histEl = el<HTMLDivElement>('#neo-hist');

  let all: NeoFlat[] = [];
  let filtered: NeoFlat[] = [];
  let page = 0;

  async function load() {
    loadBtn.disabled = true;
    listEl.textContent = 'Loading…';
    timelineEl.textContent = '';
    histEl.textContent = '';

    const s = startInput.value;
    const e = endInput.value;
    const feed = await getNeoFeed({ start_date: s, end_date: e });
    all = flattenFeed(feed);
    applyAndRender();
    loadBtn.disabled = false;
  }

  function applyAndRender() {
    const hazardOnly = hazardInput.checked;
    const mode = sortSelect.value;
    filtered = sortItems(applyFilters(all, hazardOnly), mode);
    page = 0;
    render();
  }

  function render() {
    renderNeoTimeline(timelineEl, filtered);
    renderNeoHistogram(histEl, filtered);

    renderList(listEl, filtered, page);
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    pagerInfo.textContent = `Page ${page + 1} / ${totalPages}`;
    prevBtn.disabled = page <= 0;
    nextBtn.disabled = page >= totalPages - 1;
  }

  el<HTMLFormElement>('#neo-controls').addEventListener('submit', ev => {
    ev.preventDefault();
    load();
  });
  hazardInput.addEventListener('change', applyAndRender);
  sortSelect.addEventListener('change', applyAndRender);
  prevBtn.addEventListener('click', () => {
    if (page > 0) {
      page--;
      render();
    }
  });
  nextBtn.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page < totalPages - 1) {
      page++;
      render();
    }
  });

  load().catch(err => {
    listEl.textContent = 'Failed to load NEO feed';
    console.error(err);
  });
}
