import '../styles/neo.css';
import '../styles/neo_images.css';
import { getNeoFeed } from '../api/fetch_neo';
import { searchFirstImage } from '../api/fetch_images';
import { imageCache } from '../utils/imageCache';
import { flattenFeed, type NeoFlat } from '../utils/neo';
import { renderNeoTimeline } from '../visuals/neo_timeline';
import { renderNeoHistogram } from '../visuals/neo_histogram';
import { initNeo3D, type Neo3DController } from './neo3d';
import type { NeoItem } from '../types/nasa';

const PAGE_SIZE = 20;

const MAX_CONCURRENT = 4;
let inflight = 0;
const q: Array<() => Promise<void>> = [];

function schedule(task: () => Promise<void>) {
  q.push(task);
  pump();
}

function pump() {
  while (inflight < MAX_CONCURRENT && q.length) {
    const t = q.shift()!;
    inflight++;
      t()
        .catch(err => {
          // eslint-disable-next-line no-console
          console.warn('scheduled task failed', err);
      })
      .finally(() => {
        inflight--;
        pump();
      });
  }
}

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

  const observer =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          entries => {
            const obs = observer;
            if (!obs) return;
            for (const ent of entries) {
              if (ent.isIntersecting) {
                const li = ent.target as HTMLLIElement;
                obs.unobserve(li);
                const id = li.dataset.neoId || '';
                const name = li.dataset.neoName || '';
                if (id || name) loadThumb(li, id, name);
              }
            }
          },
          { root: listEl, rootMargin: '200px' }
        )
      : null;

  for (const d of slice) {
    const li = document.createElement('li');
    li.className = 'neo-card';
    li.dataset.neoId = d.id;
    li.dataset.neoName = d.name;

    const skel = document.createElement('div');
    skel.className = 'neo-skel';
    skel.setAttribute('aria-hidden', 'true');

    const txt = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'neo-title';
    title.textContent = `${d.name}`;
    const meta = document.createElement('div');
    const miss = d.miss_ld != null ? `${d.miss_ld.toFixed(2)} LD` : '—';
    const vel = d.vel_kps != null ? `${d.vel_kps.toFixed(2)} km/s` : '—';
    const dia = d.dia_km_max != null ? `${d.dia_km_max.toFixed(2)} km` : '—';
    meta.className = 'neo-meta';
    meta.textContent = `${d.date} • miss ${miss} • v ${vel} • dia ${dia}${d.is_hazardous ? ' • hazardous' : ''}`;

    txt.appendChild(title);
    txt.appendChild(meta);

    li.appendChild(skel);
    li.appendChild(txt);

    listEl.appendChild(li);

    if (observer) {
      observer.observe(li);
    } else {
      loadThumb(li, d.id, d.name);
    }
  }
}

function loadThumb(li: HTMLLIElement, id: string, name: string) {
  const cached = imageCache.get(id) || imageCache.get(name);
  if (cached) {
    replaceThumb(li, cached.url, cached.title, cached.asset);
    return;
  }
  schedule(async () => {
    try {
      const pick = await searchFirstImage(name);
      if (pick) {
        imageCache.set(id, pick.thumbUrl, pick.title, pick.assetPage);
        imageCache.set(name, pick.thumbUrl, pick.title, pick.assetPage);
        replaceThumb(li, pick.thumbUrl, pick.title, pick.assetPage);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('image load failed', name, e);
    }
  });
}

function replaceThumb(li: HTMLLIElement, url: string, title: string, asset?: string) {
  const img = document.createElement('img');
  img.className = 'neo-thumb';
  const fallbackTitle = title || li.dataset.neoName || 'NASA Image';
  img.alt = `${fallbackTitle} (NASA Image Library)`;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.src = url;

  const curr = li.querySelector('.neo-skel');
  if (curr) {
    li.replaceChild(img, curr);
  } else {
    li.insertBefore(img, li.firstChild);
  }

  if (asset) {
    const txt = li.children.item(1) as HTMLElement | null;
    if (txt && !txt.querySelector('.neo-asset-link')) {
      const wrapper = document.createElement('div');
      wrapper.style.marginTop = '.2rem';
      const link = document.createElement('a');
      link.href = asset;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'neo-asset-link';
      link.textContent = 'Asset';
      wrapper.appendChild(link);
      txt.appendChild(wrapper);
    }
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
  let neoMap = new Map<string, NeoItem>();
  let selectedNeos: NeoItem[] = [];
  let neo3dController: Neo3DController | null = null;

  function updateSelectionFromFiltered() {
    const next: NeoItem[] = [];
    for (const item of filtered) {
      const neo = neoMap.get(item.id);
      if (neo && neo.orbital_data) {
        next.push(neo);
      }
      if (next.length >= 50) break;
    }
    selectedNeos = next;
    if (neo3dController) {
      neo3dController.setNeos(selectedNeos);
    }
  }

  async function load() {
    loadBtn.disabled = true;
    listEl.textContent = 'Loading…';
    timelineEl.textContent = '';
    histEl.textContent = '';

    const s = startInput.value;
    const e = endInput.value;
    const feed = await getNeoFeed({ start_date: s, end_date: e });
    neoMap = new Map<string, NeoItem>();
    for (const list of Object.values(feed.near_earth_objects ?? {})) {
      for (const neo of list ?? []) {
        neoMap.set(neo.id, neo);
      }
    }
    all = flattenFeed(feed);
    applyAndRender();
    if (!neo3dController) {
      neo3dController = await initNeo3D(() => selectedNeos);
    }
    if (neo3dController) {
      neo3dController.setNeos(selectedNeos);
    }
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
    updateSelectionFromFiltered();
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
