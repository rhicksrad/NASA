import { getNeoBrowse } from '../api/fetch_neo';
import { searchFirstImage } from '../api/fetch_images';
import { imageCache } from '../utils/imageCache';
import type { NeoObject } from '../types/nasa';
import './neo_images.css';

const PAGE_SIZE = 20;
const MAX_CONCURRENT = 4;
let inflight = 0;
const queue: Array<() => Promise<void>> = [];

interface NeoFlat {
  id: string;
  name: string;
  date: string;
  miss_ld: number | null;
  vel_kps: number | null;
  dia_km_max: number | null;
  is_hazardous: boolean;
}

function schedule(task: () => Promise<void>) {
  queue.push(task);
  pump();
}

function pump() {
  while (inflight < MAX_CONCURRENT && queue.length) {
    const task = queue.shift();
    if (!task) break;
    inflight++;
    void task()
      .catch(err => {
        console.warn('image task failed', err);
      })
      .finally(() => {
        inflight--;
        pump();
      });
  }
}

function parseMaybeNumber(value: string | number | undefined | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function flattenNeo(obj: NeoObject): NeoFlat {
  const approach = obj.close_approach_data?.[0];
  const date = approach?.close_approach_date_full || approach?.close_approach_date || 'Unknown';
  return {
    id: obj.id,
    name: obj.name,
    date,
    miss_ld: parseMaybeNumber(approach?.miss_distance?.lunar),
    vel_kps: parseMaybeNumber(approach?.relative_velocity?.kilometers_per_second),
    dia_km_max: obj.estimated_diameter?.kilometers?.estimated_diameter_max ?? null,
    is_hazardous: obj.is_potentially_hazardous_asteroid,
  };
}

function renderList(listEl: HTMLUListElement, items: NeoFlat[], page: number) {
  listEl.classList.add('neo-list');
  listEl.replaceChildren();
  const start = page * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);

  if (!slice.length) {
    const li = document.createElement('li');
    li.textContent = 'No objects returned in this sample.';
    listEl.appendChild(li);
    return;
  }

  const io = new IntersectionObserver(
    entries => {
      for (const ent of entries) {
        if (ent.isIntersecting) {
          const li = ent.target as HTMLLIElement;
          io.unobserve(li);
          const id = li.dataset.neoId;
          const name = li.dataset.neoName;
          if (!id || !name) continue;
          loadThumb(li, id, name);
        }
      }
    },
    { root: listEl, rootMargin: '200px' }
  );

  for (const d of slice) {
    const li = document.createElement('li');
    li.className = 'neo-card';
    li.dataset.neoId = d.id;
    li.dataset.neoName = d.name;

    const skel = document.createElement('div');
    skel.className = 'neo-skel';
    skel.setAttribute('aria-hidden', 'true');

    const txt = document.createElement('div');
    txt.className = 'neo-text';

    const title = document.createElement('div');
    title.className = 'neo-title';
    title.textContent = d.name;

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
    io.observe(li);
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
        if (name && name !== id) imageCache.set(name, pick.thumbUrl, pick.title, pick.assetPage);
        replaceThumb(li, pick.thumbUrl, pick.title, pick.assetPage);
      }
    } catch (e) {
      console.warn('image load failed', name, e);
    }
  });
}

function replaceThumb(li: HTMLLIElement, url: string, title: string, asset?: string) {
  if (!li.isConnected) return;
  const altBase = title || li.dataset.neoName || 'NASA Image';

  let img = li.querySelector('img.neo-thumb');
  if (!img) {
    img = document.createElement('img');
    img.className = 'neo-thumb';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    const curr = li.querySelector('.neo-skel');
    if (curr) {
      curr.replaceWith(img);
    } else {
      li.prepend(img);
    }
  }

  img.alt = `${altBase} (NASA Image Library)`;
  if (img.src !== url) img.src = url;

  const txt = li.querySelector('.neo-text');
  if (!txt) return;

  const existingWrap = txt.querySelector('.neo-asset-wrap');
  if (asset) {
    if (existingWrap) {
      const link = existingWrap.querySelector('a.neo-asset-link');
      if (link) link.href = asset;
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'neo-asset-wrap';
      wrap.style.marginTop = '.2rem';
      const link = document.createElement('a');
      link.href = asset;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'neo-asset-link';
      link.textContent = 'Asset';
      wrap.appendChild(link);
      txt.appendChild(wrap);
    }
  } else if (existingWrap) {
    existingWrap.remove();
  }
}

export async function initNeoSection(summaryEl: HTMLParagraphElement, listEl: HTMLUListElement): Promise<void> {
  listEl.classList.add('neo-list');
  const data = await getNeoBrowse({ size: PAGE_SIZE });
  const raw = data.near_earth_objects ?? [];
  const items = raw.map(flattenNeo);

  const total = data.page?.total_elements ?? items.length;
  summaryEl.textContent = items.length
    ? `Sample size: ${items.length} • Total known (reported): ${total}`
    : 'No objects returned in this sample.';

  if (!items.length) {
    listEl.replaceChildren();
    const li = document.createElement('li');
    li.textContent = 'No objects returned in this sample.';
    listEl.appendChild(li);
    return;
  }

  renderList(listEl, items, 0);
}
