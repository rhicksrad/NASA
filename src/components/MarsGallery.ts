// src/components/MarsGallery.ts
import { getMarsPhotos, type MarsPhoto, type RoverName } from '../api/mars';
import searchIcon from '../assets/icons/search.svg?raw';
import shuffleIcon from '../assets/icons/shuffle.svg?raw';
import chevronLeftIcon from '../assets/icons/chevron-left.svg?raw';
import chevronRightIcon from '../assets/icons/chevron-right.svg?raw';
import statusIcon from '../assets/icons/status-spark.svg?raw';

const icon = (markup: string) => `<span class="mars-icon" aria-hidden="true">${markup}</span>`;

type Mode = 'earth' | 'sol';

export class MarsGallery {
  private host: HTMLElement;
  private state = {
    rover: 'curiosity' as RoverName,
    mode: 'earth' as Mode,
    earthDate: '2015-06-03',
    sol: 100,
    camera: '',
    page: 1,
    loading: false,
    photos: [] as MarsPhoto[],
    cameras: [] as string[],
    modal: null as MarsPhoto | null,
  };

  constructor(host: HTMLElement) {
    this.host = host;
    this.host.classList.add('mars-host');
    this.renderShell();
    this.attachHandlers();
    this.refresh();
  }

  private qs<T extends HTMLElement>(sel: string): T {
    const el = this.host.querySelector(sel);
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el as T;
  }

  private renderShell() {
    this.host.innerHTML = `
      <div class="mars-controls">
        <label class="mars-field">Rover
          <select id="mg-rover">
            <option value="curiosity">Curiosity</option>
            <option value="perseverance">Perseverance</option>
            <option value="opportunity">Opportunity</option>
            <option value="spirit">Spirit</option>
          </select>
        </label>

        <label class="mars-field">Mode
          <select id="mg-mode">
            <option value="earth">Earth Date</option>
            <option value="sol">Sol</option>
          </select>
        </label>

        <label class="mars-field" id="mg-earth-wrap">Earth Date
          <input id="mg-earth" type="date" value="${this.state.earthDate}" />
        </label>

        <label class="mars-field mars-field--sol mars-hidden" id="mg-sol-wrap">Sol
          <input id="mg-sol" type="number" min="0" max="4000" step="1" value="${this.state.sol}" />
        </label>

        <label class="mars-field">Camera
          <select id="mg-camera">
            <option value="">(any)</option>
          </select>
        </label>

        <button id="mg-search" class="mars-action" type="button">${icon(searchIcon)}<span>Search</span></button>
        <button id="mg-random" class="mars-action mars-action--ghost" type="button" title="Pick a fun date/sol">${icon(
          shuffleIcon,
        )}<span>Surprise me</span></button>

        <span id="mg-status" class="mars-status-indicator">${icon(statusIcon)}<span class="mars-status-text"></span></span>
      </div>

      <div id="mg-grid" class="mars-grid"></div>

      <div class="mars-pager">
        <button id="mg-prev" class="mars-page" type="button">${icon(chevronLeftIcon)}<span>Prev</span></button>
        <span id="mg-page"></span>
        <button id="mg-next" class="mars-page" type="button"><span>Next</span>${icon(chevronRightIcon)}</button>
      </div>

      <dialog id="mg-modal" class="mars-modal">
        <div class="mars-modal-content">
          <img id="mg-full" alt="Mars" class="mars-modal-image" />
          <div id="mg-meta" class="mars-modal-meta"></div>
          <div class="mars-modal-actions">
            <a id="mg-open" href="#" target="_blank" rel="noopener" class="mars-action mars-action--ghost">Open original</a>
            <button id="mg-close" type="button" class="mars-action">Close</button>
          </div>
        </div>
      </dialog>
    `;
  }

  private attachHandlers() {
    this.qs<HTMLSelectElement>('#mg-rover').addEventListener('change', e => {
      this.state.rover = (e.target as HTMLSelectElement).value as RoverName;
    });
    this.qs<HTMLSelectElement>('#mg-mode').addEventListener('change', e => {
      const v = (e.target as HTMLSelectElement).value as Mode;
      this.state.mode = v;
      this.qs('#mg-earth-wrap').classList.toggle('mars-hidden', v !== 'earth');
      this.qs('#mg-sol-wrap').classList.toggle('mars-hidden', v !== 'sol');
    });
    this.qs<HTMLInputElement>('#mg-earth').addEventListener('change', e => {
      this.state.earthDate = (e.target as HTMLInputElement).value || this.state.earthDate;
    });
    this.qs<HTMLInputElement>('#mg-sol').addEventListener('change', e => {
      const n = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(n) && n >= 0) this.state.sol = n;
    });
    this.qs<HTMLSelectElement>('#mg-camera').addEventListener('change', e => {
      this.state.camera = (e.target as HTMLSelectElement).value || '';
    });
    this.qs<HTMLButtonElement>('#mg-search').addEventListener('click', () => {
      this.state.page = 1;
      this.refresh();
    });
    this.qs<HTMLButtonElement>('#mg-random').addEventListener('click', () => {
      // Lightweight "surprise" presets that tend to have images
      const presets: ReadonlyArray<
        | { rover: RoverName; mode: 'earth'; earthDate: string }
        | { rover: RoverName; mode: 'sol'; sol: number }
      > = [
        { rover: 'curiosity', mode: 'earth', earthDate: '2015-06-03' },
        { rover: 'perseverance', mode: 'sol', sol: 100 },
        { rover: 'opportunity', mode: 'sol', sol: 1500 },
        { rover: 'spirit', mode: 'earth', earthDate: '2004-03-08' },
      ];
      const pick = presets[Math.floor(Math.random() * presets.length)];
      this.state.rover = pick.rover;
      this.state.mode = pick.mode;
      if (pick.mode === 'earth') {
        this.state.earthDate = pick.earthDate;
      } else {
        this.state.sol = pick.sol;
      }
      this.syncControls();
      this.state.page = 1;
      this.refresh();
    });
    this.qs<HTMLButtonElement>('#mg-prev').addEventListener('click', () => {
      if (this.state.page > 1) { this.state.page -= 1; this.refresh(); }
    });
    this.qs<HTMLButtonElement>('#mg-next').addEventListener('click', () => {
      this.state.page += 1; this.refresh();
    });

    this.qs<HTMLButtonElement>('#mg-close').addEventListener('click', () => {
      this.qs<HTMLDialogElement>('#mg-modal').close();
    });
  }

  private syncControls() {
    this.qs<HTMLSelectElement>('#mg-rover').value = this.state.rover;
    this.qs<HTMLSelectElement>('#mg-mode').value  = this.state.mode;
    this.qs<HTMLInputElement>('#mg-earth').value  = this.state.earthDate;
    this.qs<HTMLInputElement>('#mg-sol').value    = String(this.state.sol);
    this.qs('#mg-earth-wrap').classList.toggle('mars-hidden', this.state.mode !== 'earth');
    this.qs('#mg-sol-wrap').classList.toggle('mars-hidden', this.state.mode !== 'sol');
  }

  private async refresh() {
    if (this.state.loading) return;
    this.state.loading = true;
    this.setStatus('Loading…');

    try {
      const query = {
        rover: this.state.rover,
        page: this.state.page,
        camera: this.state.camera || undefined,
        earthDate: this.state.mode === 'earth' ? this.state.earthDate : undefined,
        sol: this.state.mode === 'sol' ? this.state.sol : undefined,
      };
      const { photos, cameras } = await getMarsPhotos(query);

      // Update camera dropdown (preserve current selection if present)
      const sel = this.qs<HTMLSelectElement>('#mg-camera');
      const prev = sel.value;
      sel.innerHTML = `<option value="">(any)</option>` + cameras.map(c => `<option value="${c}">${c}</option>`).join('');
      if (prev && cameras.includes(prev)) {
        sel.value = prev;
      } else {
        sel.value = '';
        this.state.camera = '';
      }

      this.state.photos = photos;
      this.state.cameras = cameras;
      this.renderGrid();
      this.setStatus(`${photos.length} photo(s)`);
    } catch (error: unknown) {
      console.error('[mars] fetch failed', error);
      const message = error instanceof Error ? error.message : 'Fetch failed';
      this.setStatus(message);
      this.qs('#mg-grid').innerHTML = `<div style="opacity:0.8;">Error loading photos.</div>`;
    } finally {
      this.qs('#mg-page').textContent = `Page ${this.state.page}`;
      this.state.loading = false;
    }
  }

  private renderGrid() {
    const grid = this.qs('#mg-grid');
    if (!this.state.photos.length) {
      grid.innerHTML = `<div class="mars-empty">No photos for that selection.</div>`;
      return;
    }
    grid.innerHTML = this.state.photos
      .map(
        (p) => `
      <figure class="mars-tile">
        <button class="mars-thumb-button" data-id="${p.id}" type="button">
          <img src="${p.src}" alt="${p.rover.name} ${p.camera.name}" class="mars-thumb" />
        </button>
        <figcaption class="mars-caption">
          ${p.rover.name} • ${p.camera.name} • ${p.earthDate}${p.sol != null ? ` • Sol ${p.sol}` : ''}
        </figcaption>
      </figure>
    `,
      )
      .join('');

    grid.querySelectorAll<HTMLButtonElement>('.mars-thumb-button').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const p = this.state.photos.find(x => x.id === id);
        if (!p) return;
        this.openModal(p);
      });
    });
  }

  private openModal(p: MarsPhoto) {
    const dlg = this.qs<HTMLDialogElement>('#mg-modal');
    this.qs<HTMLImageElement>('#mg-full').src = p.src;
    this.qs('#mg-meta').innerHTML = `
      <div><b>${p.rover.name}</b> • ${p.camera.full_name || p.camera.name}</div>
      <div>Earth date: ${p.earthDate}${p.sol != null ? ` • Sol ${p.sol}` : ''}</div>
      <div>Status: ${p.rover.status || '—'}${p.rover.landing_date ? ` • Landed: ${p.rover.landing_date}` : ''}</div>
    `.trim();
    const a = this.qs<HTMLAnchorElement>('#mg-open');
    a.href = p.src;
    dlg.showModal();
  }

  private setStatus(msg: string) {
    this.qs('#mg-status .mars-status-text').textContent = msg;
  }
}
