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
import { icon } from '../utils/icons';

const PAGE_SIZE = 20;

const MAX_CONCURRENT = 4;

function createScheduler(maxConcurrent: number, isCancelled: () => boolean) {
  let inflight = 0;
  const queue: Array<() => Promise<void>> = [];

  const pump = () => {
    if (isCancelled()) {
      queue.length = 0;
      return;
    }
    while (inflight < maxConcurrent && queue.length) {
      const job = queue.shift()!;
      inflight++;
      Promise.resolve()
        .then(async () => {
          if (isCancelled()) {
            return;
          }
          try {
            await job();
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('scheduled task failed', err);
          }
        })
        .finally(() => {
          inflight--;
          pump();
        });
    }
  };

  return {
    schedule(task: () => Promise<void>) {
      if (isCancelled()) {
        return;
      }
      queue.push(async () => {
        if (isCancelled()) {
          return;
        }
        await task();
      });
      pump();
    },
    clear() {
      queue.length = 0;
    },
  };
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


export async function initNeoPage(): Promise<() => void> {
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
  const controlsForm = el<HTMLFormElement>('#neo-controls');

  const timelineEl = el<HTMLDivElement>('#neo-timeline');
  const histEl = el<HTMLDivElement>('#neo-hist');
  const listWrap = el<HTMLDivElement>('#neo-list-wrap');

  const statusEl = document.createElement('div');
  statusEl.className = 'neo-status';
  statusEl.id = 'neo-status';
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  statusEl.hidden = true;
  listWrap.insertBefore(statusEl, listEl);

  let destroyed = false;
  const { schedule, clear } = createScheduler(MAX_CONCURRENT, () => destroyed);
  let listObserver: IntersectionObserver | null = null;

  let all: NeoFlat[] = [];
  let filtered: NeoFlat[] = [];
  let page = 0;
  let neoMap = new Map<string, NeoItem>();
  let selectedNeos: NeoItem[] = [];
  let neo3dController: Neo3DController | null = null;
  let activeLoadToken = 0;

  const setStatus = (message: string | null, tone: 'info' | 'error' = 'info') => {
    if (!message) {
      statusEl.textContent = '';
      statusEl.hidden = true;
      statusEl.removeAttribute('data-tone');
      return;
    }
    statusEl.hidden = false;
    const statusIcon = tone === 'error' ? icon('alert', { label: 'Error status' }) : icon('info', { label: 'Status update' });
    statusEl.innerHTML = statusIcon;
    const text = document.createElement('span');
    text.textContent = message;
    statusEl.appendChild(text);
    statusEl.dataset.tone = tone;
  };

  const replaceThumb = (li: HTMLLIElement, url: string, title: string, asset?: string) => {
    if (destroyed || !listEl.contains(li)) {
      return;
    }
    const img = document.createElement('img');
    img.className = 'neo-thumb';
    const fallbackTitle = title || li.dataset.neoName || 'NASA Image';
    img.alt = `${fallbackTitle} (NASA Image Library)`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.src = url;

    const skeleton = li.querySelector('.neo-skel');
    if (skeleton) {
      li.replaceChild(img, skeleton);
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
        link.innerHTML = `${icon('external', { label: 'Open asset in new tab' })}<span>Asset</span>`;
        wrapper.appendChild(link);
        txt.appendChild(wrapper);
      }
    }
  };

  const loadThumb = (li: HTMLLIElement, id: string, name: string) => {
    if (destroyed) {
      return;
    }
    const cached = imageCache.get(id) || imageCache.get(name);
    if (cached) {
      replaceThumb(li, cached.url, cached.title, cached.asset);
      return;
    }
    schedule(async () => {
      if (destroyed) return;
      try {
        const pick = await searchFirstImage(name);
        if (!pick || destroyed) {
          return;
        }
        imageCache.set(id, pick.thumbUrl, pick.title, pick.assetPage);
        imageCache.set(name, pick.thumbUrl, pick.title, pick.assetPage);
        replaceThumb(li, pick.thumbUrl, pick.title, pick.assetPage);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('image load failed', name, error);
      }
    });
  };

  const renderList = (items: NeoFlat[], currentPage: number) => {
    if (listObserver) {
      listObserver.disconnect();
      listObserver = null;
    }

    listEl.replaceChildren();
    const startIndex = currentPage * PAGE_SIZE;
    const slice = items.slice(startIndex, startIndex + PAGE_SIZE);

    if (!slice.length) {
      const li = document.createElement('li');
      li.className = 'neo-card neo-card--empty';
      li.textContent = 'No objects match the current filters.';
      listEl.appendChild(li);
      return;
    }

    if (typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(
        entries => {
          if (destroyed) {
            return;
          }
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const target = entry.target as HTMLLIElement;
              observer.unobserve(target);
              const id = target.dataset.neoId || '';
              const name = target.dataset.neoName || '';
              if (id || name) {
                loadThumb(target, id, name);
              }
            }
          }
        },
        { root: listEl, rootMargin: '200px' },
      );
      listObserver = observer;
    }

    for (const data of slice) {
      const li = document.createElement('li');
      li.className = 'neo-card';
      li.dataset.neoId = data.id;
      li.dataset.neoName = data.name;

      const skeleton = document.createElement('div');
      skeleton.className = 'neo-skel';
      skeleton.setAttribute('aria-hidden', 'true');

      const textWrap = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'neo-title';
      title.textContent = data.name;
      const meta = document.createElement('div');
      meta.className = 'neo-meta';
      const miss = data.miss_ld != null ? `${data.miss_ld.toFixed(2)} LD` : '—';
      const vel = data.vel_kps != null ? `${data.vel_kps.toFixed(2)} km/s` : '—';
      const dia = data.dia_km_max != null ? `${data.dia_km_max.toFixed(2)} km` : '—';
      meta.textContent = `${data.date} • miss ${miss} • v ${vel} • dia ${dia}${data.is_hazardous ? ' • hazardous' : ''}`;

      textWrap.appendChild(title);
      textWrap.appendChild(meta);

      li.appendChild(skeleton);
      li.appendChild(textWrap);
      listEl.appendChild(li);

      if (listObserver) {
        listObserver.observe(li);
      } else {
        loadThumb(li, data.id, data.name);
      }
    }
  };

  const updateSelectionFromFiltered = () => {
    const next: NeoItem[] = [];
    for (const item of filtered) {
      const neo = neoMap.get(item.id);
      if (neo && neo.orbital_data) {
        next.push(neo);
      }
      if (next.length >= 50) {
        break;
      }
    }
    selectedNeos = next;
    if (neo3dController) {
      neo3dController.setNeos(selectedNeos);
    }
  };

  const render = () => {
    updateSelectionFromFiltered();
    renderNeoTimeline(timelineEl, filtered);
    renderNeoHistogram(histEl, filtered);

    renderList(filtered, page);
    listEl.removeAttribute('aria-busy');
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    pagerInfo.textContent = `Page ${page + 1} / ${totalPages}`;
    prevBtn.disabled = page <= 0;
    nextBtn.disabled = page >= totalPages - 1;
  };

  const applyAndRender = () => {
    const hazardOnly = hazardInput.checked;
    const mode = sortSelect.value;
    filtered = sortItems(applyFilters(all, hazardOnly), mode);
    page = 0;
    render();
  };

  const validateRange = (): { start: string; end: string } | { error: string } => {
    const startValue = startInput.value;
    const endValue = endInput.value;
    if (!startValue || !endValue) {
      return { error: 'Start and end dates are required.' };
    }
    const startDate = new Date(`${startValue}T00:00:00Z`);
    const endDate = new Date(`${endValue}T00:00:00Z`);
    if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf())) {
      return { error: 'Enter valid start and end dates.' };
    }
    if (startDate > endDate) {
      return { error: 'Start date must be on or before the end date.' };
    }
    const diffDays = Math.round((endDate.valueOf() - startDate.valueOf()) / 86_400_000);
    if (diffDays > 6) {
      return { error: 'NASA NeoWs only supports seven-day ranges. Choose a shorter window.' };
    }
    return { start: startValue, end: endValue };
  };

  const load = async () => {
    if (destroyed) {
      return;
    }
    const range = validateRange();
    if ('error' in range) {
      setStatus(range.error, 'error');
      return;
    }

    const token = ++activeLoadToken;
    loadBtn.disabled = true;
    listEl.setAttribute('aria-busy', 'true');
    listEl.replaceChildren();
    const loadingLi = document.createElement('li');
    loadingLi.className = 'neo-card neo-card--loading';
    loadingLi.textContent = 'Loading NEO feed…';
    listEl.appendChild(loadingLi);
    timelineEl.replaceChildren();
    histEl.replaceChildren();
    setStatus('Loading near-Earth objects…');

    try {
      const feed = await getNeoFeed({ start_date: range.start, end_date: range.end });
      if (destroyed || token !== activeLoadToken) {
        return;
      }
      const nextMap = new Map<string, NeoItem>();
      for (const list of Object.values(feed.near_earth_objects ?? {})) {
        for (const neo of list ?? []) {
          nextMap.set(neo.id, neo);
        }
      }
      neoMap = nextMap;
      all = flattenFeed(feed);
      applyAndRender();
      if (!neo3dController) {
        neo3dController = await initNeo3D(() => selectedNeos);
      }
      if (!destroyed && token === activeLoadToken && neo3dController) {
        neo3dController.setNeos(selectedNeos);
      }
      if (!destroyed && token === activeLoadToken) {
        setStatus(null);
      }
    } catch (err) {
      if (!destroyed && token === activeLoadToken) {
        console.error(err);
        setStatus('Failed to load NEO feed. Restoring previous results.', 'error');
        render();
      }
    } finally {
      if (!destroyed && token === activeLoadToken) {
        loadBtn.disabled = false;
      }
    }
  };

  const onFormSubmit = (event: Event) => {
    event.preventDefault();
    void load();
  };
  const onHazardChange = () => {
    applyAndRender();
  };
  const onSortChange = () => {
    applyAndRender();
  };
  const onPrevClick = () => {
    if (page > 0) {
      page -= 1;
      render();
    }
  };
  const onNextClick = () => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page < totalPages - 1) {
      page += 1;
      render();
    }
  };

  controlsForm.addEventListener('submit', onFormSubmit);
  hazardInput.addEventListener('change', onHazardChange);
  sortSelect.addEventListener('change', onSortChange);
  prevBtn.addEventListener('click', onPrevClick);
  nextBtn.addEventListener('click', onNextClick);

  void load();

  return () => {
    destroyed = true;
    clear();
    listObserver?.disconnect();
    listObserver = null;
    controlsForm.removeEventListener('submit', onFormSubmit);
    hazardInput.removeEventListener('change', onHazardChange);
    sortSelect.removeEventListener('change', onSortChange);
    prevBtn.removeEventListener('click', onPrevClick);
    nextBtn.removeEventListener('click', onNextClick);
  };
}
