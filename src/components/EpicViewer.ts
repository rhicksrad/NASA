/* src/components/EpicViewer.ts */
import { fetchEpicLatest, fetchEpicByDate, buildEpicImageUrl, extractLatestDate, type EpicItem } from '../api/epic';

type State = {
  date: string; // YYYY-MM-DD
  items: EpicItem[];
  idx: number; // current frame index
  playing: boolean;
  fps: number; // frames per second when playing
};

type Attrs = Record<string, unknown>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Array<Node | string>) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') {
      el.className = String(v);
    } else if (k === 'style' && typeof v === 'object') {
      Object.assign(el.style, v as Record<string, string>);
    } else if (k.startsWith('on') && typeof v === 'function') {
      type WithHandlers = HTMLElement & Record<string, unknown>;
      (el as WithHandlers)[k.toLowerCase()] = v;
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const kid of kids) el.append(kid);
  return el;
}

export class EpicViewer {
  private host: HTMLElement;
  private imgEl!: HTMLImageElement;
  private slider!: HTMLInputElement;
  private playBtn!: HTMLButtonElement;
  private dateInput!: HTMLInputElement;
  private fpsSel!: HTMLSelectElement;
  private metaEl!: HTMLDivElement;

  private state: State = { date: '', items: [], idx: 0, playing: false, fps: 4 };
  private rafId: number | null = null;
  private lastTick = 0;
  private preloadMap = new Map<string, HTMLImageElement>(); // url → img

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderShell();
    this.init();
  }

  private renderShell() {
    const controls = h(
      'div',
      { class: 'epic-controls' },
      h(
        'label',
        { class: 'epic-label' },
        'Date (UTC): ',
        (this.dateInput = h('input', { type: 'date', class: 'epic-date' }) as HTMLInputElement),
      ),
      (this.playBtn = h('button', { class: 'epic-btn' }, 'Play') as HTMLButtonElement),
      h(
        'label',
        { class: 'epic-label' },
        'Speed: ',
        (this.fpsSel = h(
          'select',
          { class: 'epic-fps' },
          ...[2, 4, 8, 12, 24].map(v => h('option', { value: String(v) }, String(v), ' fps')),
        ) as HTMLSelectElement),
      ),
    );

    const timeline = h(
      'div',
      { class: 'epic-timeline' },
      (this.slider = h('input', { type: 'range', min: '0', max: '0', value: '0', class: 'epic-slider' }) as HTMLInputElement),
    );

    const stage = h(
      'div',
      { class: 'epic-stage' },
      (this.imgEl = h('img', { alt: 'EPIC Earth', class: 'epic-image' }) as HTMLImageElement),
      (this.metaEl = h('div', { class: 'epic-meta' })),
    );

    const wrap = h('div', { class: 'epic-wrap' }, controls, timeline, stage);
    this.host.replaceChildren(wrap);

    // Wire events
    this.playBtn.onclick = () => this.togglePlay();
    this.slider.oninput = () => this.goTo(Number(this.slider.value));
    this.fpsSel.onchange = () => this.setFps(Number(this.fpsSel.value));
    this.dateInput.onchange = () => this.loadDate(this.dateInput.value);
  }

  private async init() {
    try {
      const latest = await fetchEpicLatest();
      const latestDate = extractLatestDate(latest);
      const date = latestDate ?? new Date().toISOString().slice(0, 10);
      this.dateInput.value = date;
      await this.loadDate(date);
      this.setFps(4);
    } catch (err) {
      this.error(String(err));
    }
  }

  private async loadDate(date: string) {
    this.stop();
    this.state.date = date;
    this.state.idx = 0;
    try {
      const day = await fetchEpicByDate(date);
      this.state.items = day.items;
      this.slider.max = Math.max(0, this.state.items.length - 1).toString();
      this.slider.value = '0';
      if (this.state.items.length === 0) {
        this.imgEl.src = '';
        this.metaEl.textContent = `No EPIC images for ${date}`;
        return;
      }
      // Preload first few frames
      this.preloadWindow(0, Math.min(6, this.state.items.length - 1));
      this.renderFrame(0);
    } catch (err) {
      this.error(String(err));
    }
  }

  private urlAt(idx: number) {
    const it = this.state.items[idx];
    return buildEpicImageUrl(it);
  }

  private renderFrame(idx: number) {
    this.state.idx = idx;
    const it = this.state.items[idx];
    const url = this.urlAt(idx);
    this.imgEl.referrerPolicy = 'no-referrer';
    this.imgEl.src = url; // <img> can load cross-origin fine
    const t = it.date.replace(' ', ' ');
    const loc = it.centroid_coordinates
      ? `lat ${it.centroid_coordinates.lat.toFixed(2)}, lon ${it.centroid_coordinates.lon.toFixed(2)}`
      : '';
    this.metaEl.textContent = `${t}  ${loc}  —  ${it.caption || it.identifier}`;
    this.slider.value = String(idx);
    // Preload ahead a little
    this.preloadWindow(idx + 1, Math.min(idx + 6, this.state.items.length - 1));
  }

  private preloadWindow(from: number, to: number) {
    for (let i = from; i <= to; i++) {
      const url = this.urlAt(i);
      if (!this.preloadMap.has(url)) {
        const img = new Image();
        img.decoding = 'async';
        img.loading = 'eager';
        img.src = url;
        this.preloadMap.set(url, img);
      }
    }
  }

  private setFps(fps: number) {
    this.state.fps = Math.max(1, fps | 0);
    // snap tick budget
    this.lastTick = 0;
  }

  private togglePlay() {
    this.state.playing ? this.stop() : this.play();
  }

  private play() {
    if (this.state.items.length === 0) return;
    this.state.playing = true;
    this.playBtn.textContent = 'Pause';
    const stepMs = 1000 / this.state.fps;

    const loop = (ts: number) => {
      if (!this.state.playing) return;
      if (this.lastTick === 0 || ts - this.lastTick >= stepMs) {
        this.lastTick = ts;
        const next = (this.state.idx + 1) % Math.max(1, this.state.items.length);
        this.renderFrame(next);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stop() {
    this.state.playing = false;
    this.playBtn.textContent = 'Play';
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private goTo(idx: number) {
    if (this.state.items.length === 0) return;
    const clamped = Math.max(0, Math.min(idx, this.state.items.length - 1));
    this.renderFrame(clamped);
  }

  private error(msg: string) {
    this.imgEl.src = '';
    this.metaEl.textContent = msg;
  }
}
