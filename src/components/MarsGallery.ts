// src/components/MarsGallery.ts
import { getMarsPhotos, type MarsPhoto, type RoverName } from '../api/mars';
import { icon } from '../utils/icons';

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
      <div class="mars-toolbar" style="display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:12px;">
        <label><span class="mars-label">${icon('mars')}<span>Rover</span></span>
          <select id="mg-rover">
            <option value="curiosity">Curiosity</option>
            <option value="perseverance">Perseverance</option>
            <option value="opportunity">Opportunity</option>
            <option value="spirit">Spirit</option>
          </select>
        </label>

        <label><span class="mars-label">${icon('speed')}<span>Mode</span></span>
          <select id="mg-mode">
            <option value="earth">Earth Date</option>
            <option value="sol">Sol</option>
          </select>
        </label>

        <label id="mg-earth-wrap"><span class="mars-label">${icon('calendar')}<span>Earth Date</span></span>
          <input id="mg-earth" type="date" value="${this.state.earthDate}" />
        </label>

        <label id="mg-sol-wrap" style="display:none;"><span class="mars-label">${icon('sun')}<span>Sol</span></span>
          <input id="mg-sol" type="number" min="0" max="4000" step="1" value="${this.state.sol}" />
        </label>

        <label><span class="mars-label">${icon('camera')}<span>Camera</span></span>
          <select id="mg-camera">
            <option value="">(any)</option>
          </select>
        </label>

        <button id="mg-search">${icon('search')}<span>Search</span></button>
        <button id="mg-random" title="Pick a fun date/sol">${icon('sparkle')}<span>Surprise me</span></button>

        <span id="mg-status" style="margin-left:auto; font-size:12px; opacity:0.8;"></span>
      </div>

      <div id="mg-grid" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:10px;"></div>

      <div class="mars-pager" style="display:flex; gap:8px; justify-content:center; margin:16px 0;">
        <button id="mg-prev">${icon('arrowLeft')}<span>Prev</span></button>
        <span id="mg-page"></span>
        <button id="mg-next">${icon('arrowRight')}<span>Next</span></button>
      </div>

      <dialog id="mg-modal" style="max-width:min(92vw,1200px);">
        <div style="display:flex; flex-direction:column; gap:8px;">
          <img id="mg-full" alt="Mars" style="max-width:100%; height:auto;"/>
          <div id="mg-meta" style="font-size:14px; opacity:0.9;"></div>
          <div style="display:flex; gap:8px; justify-content:flex-end;">
            <a id="mg-open" href="#" target="_blank" rel="noopener" class="mars-modal-link">${icon('external')}<span>Open original</span></a>
            <button id="mg-close">${icon('close')}<span>Close</span></button>
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
      this.qs('#mg-earth-wrap').style.display = v === 'earth' ? '' : 'none';
      this.qs('#mg-sol-wrap').style.display   = v === 'sol'   ? '' : 'none';
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
    this.qs('#mg-earth-wrap').style.display = this.state.mode === 'earth' ? '' : 'none';
    this.qs('#mg-sol-wrap').style.display   = this.state.mode === 'sol'   ? '' : 'none';
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
      grid.innerHTML = `<div style="opacity:0.8;">No photos for that selection.</div>`;
      return;
    }
    grid.innerHTML = this.state.photos.map(p => `
      <figure style="margin:0;">
        <button class="mg-thumb" data-id="${p.id}" style="padding:0; border:none; background:none; cursor:pointer;">
          <img src="${p.src}" alt="${p.rover.name} ${p.camera.name}" style="width:100%; height:220px; object-fit:cover; border-radius:6px;"/>
        </button>
        <figcaption style="font-size:12px; opacity:0.8; margin-top:4px;">
          ${p.rover.name} • ${p.camera.name} • ${p.earthDate}${p.sol != null ? ` • Sol ${p.sol}` : ''}
        </figcaption>
      </figure>
    `).join('');

    grid.querySelectorAll<HTMLButtonElement>('.mg-thumb').forEach(btn => {
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
    this.qs('#mg-status').textContent = msg;
  }
}
