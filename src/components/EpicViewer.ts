/* src/components/EpicViewer.ts */
import { fetchEpicLatest, fetchEpicByDate, buildEpicImageUrl, extractLatestDate, type EpicItem } from '../api/epic';
import playIcon from '../assets/icons/play.svg?raw';
import pauseIcon from '../assets/icons/pause.svg?raw';
import rangeIcon from '../assets/icons/range.svg?raw';
import cloudIcon from '../assets/icons/cloud-download.svg?raw';
import speedIcon from '../assets/icons/speed.svg?raw';

const DAY_MS = 24 * 60 * 60 * 1000;

function enumerateDates(start: string, end: string): string[] {
  const matchDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!matchDate.test(start) || !matchDate.test(end)) return [];
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs > endMs) {
    return [];
  }
  const days: string[] = [];
  for (let ts = startMs; ts <= endMs; ts += DAY_MS) {
    const iso = new Date(ts).toISOString();
    days.push(iso.slice(0, 10));
  }
  return days;
}

type State = {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
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

function iconSpan(markup: string, className = 'epic-icon'): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = markup;
  const svg = span.querySelector('svg');
  if (svg) {
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
  }
  return span;
}

export class EpicViewer {
  private host: HTMLElement;
  private imgEl!: HTMLImageElement;
  private slider!: HTMLInputElement;
  private playBtn!: HTMLButtonElement;
  private startInput!: HTMLInputElement;
  private endInput!: HTMLInputElement;
  private loadBtn!: HTMLButtonElement;
  private loadLabel!: HTMLSpanElement;
  private fpsSel!: HTMLSelectElement;
  private metaEl!: HTMLDivElement;

  private state: State = { startDate: '', endDate: '', items: [], idx: 0, playing: false, fps: 4 };
  private rafId: number | null = null;
  private lastTick = 0;
  private preloadMap = new Map<string, HTMLImageElement>(); // url → img
  private loadToken = 0;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderShell();
    this.init();
  }

  private renderShell() {
    const rangeControls = h(
      'div',
      { class: 'epic-range-group' },
      h(
        'label',
        { class: 'epic-label epic-label-stack' },
        h('span', { class: 'epic-label-heading' }, iconSpan(rangeIcon, 'epic-icon epic-icon--label'), 'Start (UTC)'),
        (this.startInput = h('input', { type: 'date', class: 'epic-date' }) as HTMLInputElement),
      ),
      h(
        'label',
        { class: 'epic-label epic-label-stack' },
        h('span', { class: 'epic-label-heading' }, iconSpan(rangeIcon, 'epic-icon epic-icon--label'), 'End (UTC)'),
        (this.endInput = h('input', { type: 'date', class: 'epic-date' }) as HTMLInputElement),
      ),
      (this.loadBtn = h('button', { class: 'epic-btn epic-btn-secondary', type: 'button' }) as HTMLButtonElement),
    );

    const controls = h(
      'div',
      { class: 'epic-controls' },
      rangeControls,
      (this.playBtn = h('button', { class: 'epic-btn', type: 'button' }) as HTMLButtonElement),
      h(
        'label',
        { class: 'epic-label epic-label-inline' },
        iconSpan(speedIcon, 'epic-icon epic-icon--label'),
        'Speed:',
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

    const note = h(
      'p',
      { class: 'epic-note' },
      'On 16 July 2025, DSCOVR suffered a software bus anomaly, which put it offline without an estimated date for recovery.',
    );

    const wrap = h('div', { class: 'epic-wrap' }, stage, timeline, controls, note);
    this.host.replaceChildren(wrap);

    this.loadLabel = document.createElement('span');
    this.loadLabel.className = 'epic-btn-label';
    this.loadLabel.textContent = 'Load Range';
    this.loadBtn.append(iconSpan(cloudIcon, 'epic-icon epic-icon--button'), this.loadLabel);
    this.renderPlayButton();

    // Wire events
    this.playBtn.onclick = () => this.togglePlay();
    this.loadBtn.onclick = () => this.onRangeSubmit();
    this.slider.oninput = () => this.goTo(Number(this.slider.value));
    this.fpsSel.onchange = () => this.setFps(Number(this.fpsSel.value));
    this.startInput.onchange = () => {
      this.syncRangeInputs();
    };
    this.endInput.onchange = () => {
      this.syncRangeInputs();
    };
  }

  private async init() {
    try {
      const latest = await fetchEpicLatest();
      const latestDate = extractLatestDate(latest);
      const end = latestDate ?? new Date().toISOString().slice(0, 10);
      this.startInput.value = end;
      this.endInput.value = end;
      this.startInput.max = end;
      this.endInput.max = end;
      this.syncRangeInputs();
      await this.loadRange(end, end);
      this.setFps(4);
    } catch (err) {
      this.error(String(err));
    }
  }

  private async loadRange(start: string, end: string) {
    const normalizedStart = start?.trim();
    const normalizedEnd = end?.trim();
    if (!normalizedStart || !normalizedEnd) {
      this.error('Select both a start and end date.');
      return;
    }

    const days = enumerateDates(normalizedStart, normalizedEnd);
    if (!days.length) {
      this.error('Start date must be on or before end date.');
      return;
    }

    this.startInput.value = normalizedStart;
    this.endInput.value = normalizedEnd;
    this.syncRangeInputs();

    const token = ++this.loadToken;
    this.stop();
    this.state.startDate = normalizedStart;
    this.state.endDate = normalizedEnd;
    this.state.idx = 0;
    this.state.items = [];
    this.preloadMap.clear();
    this.playBtn.disabled = true;
    this.renderPlayButton();
    this.slider.disabled = true;
    this.slider.max = '0';
    this.slider.value = '0';
    this.imgEl.src = '';
    this.metaEl.textContent = 'Loading EPIC imagery…';
    this.loadBtn.disabled = true;
    this.loadLabel.textContent = 'Loading…';

    try {
      const collected: EpicItem[] = [];
      for (const day of days) {
        const payload = await fetchEpicByDate(day);
        if (token !== this.loadToken) {
          return;
        }
        collected.push(...payload.items);
      }

      if (token !== this.loadToken) {
        return;
      }

      collected.sort((a, b) => a.date.localeCompare(b.date));
      this.state.items = collected;
      this.updateControlsForItems();

      if (collected.length === 0) {
        this.metaEl.textContent = `No EPIC images between ${normalizedStart} and ${normalizedEnd}.`;
        return;
      }

      this.renderFrame(0);
    } catch (err) {
      if (token === this.loadToken) {
        this.error(String(err));
      }
    } finally {
      if (token === this.loadToken) {
        this.loadBtn.disabled = false;
        this.loadLabel.textContent = 'Load Range';
      }
    }
  }

  private urlAt(idx: number) {
    const it = this.state.items[idx];
    return it ? buildEpicImageUrl(it) : '';
  }

  private renderFrame(idx: number) {
    this.state.idx = idx;
    const it = this.state.items[idx];
    if (!it) return;
    const url = this.urlAt(idx);
    if (!url) return;
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
      if (!url || this.preloadMap.has(url)) {
        continue;
      }
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.src = url;
      this.preloadMap.set(url, img);
    }
  }

  private setFps(fps: number) {
    this.state.fps = Math.max(1, fps | 0);
    this.fpsSel.value = String(this.state.fps);
    // snap tick budget
    this.lastTick = 0;
  }

  private togglePlay() {
    this.state.playing ? this.stop() : this.play();
  }

  private renderPlayButton() {
    if (!this.playBtn) return;
    this.playBtn.textContent = '';
    const markup = this.state.playing ? pauseIcon : playIcon;
    const label = this.state.playing ? 'Pause' : 'Play';
    this.playBtn.append(iconSpan(markup, 'epic-icon epic-icon--button'), document.createTextNode(label));
  }

  private play() {
    if (this.state.items.length === 0 || this.playBtn.disabled) return;
    this.state.playing = true;
    this.renderPlayButton();
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
    this.renderPlayButton();
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private goTo(idx: number) {
    if (this.state.items.length === 0) return;
    const clamped = Math.max(0, Math.min(idx, this.state.items.length - 1));
    this.renderFrame(clamped);
  }

  private syncRangeInputs() {
    const start = this.startInput.value;
    if (start) {
      this.endInput.min = start;
      if (this.endInput.value && this.endInput.value < start) {
        this.endInput.value = start;
      }
    } else {
      this.endInput.removeAttribute('min');
    }
    if (this.endInput.value) {
      this.startInput.max = this.endInput.value;
    } else if (this.endInput.max) {
      this.startInput.max = this.endInput.max;
    } else {
      this.startInput.removeAttribute('max');
    }
  }

  private onRangeSubmit() {
    const start = this.startInput.value;
    const end = this.endInput.value || start;
    if (!this.endInput.value && start) {
      this.endInput.value = start;
    }
    this.syncRangeInputs();
    void this.loadRange(start, end);
  }

  private updateControlsForItems() {
    const len = this.state.items.length;
    if (len === 0) {
      this.slider.max = '0';
      this.slider.value = '0';
    } else {
      const clamped = Math.max(0, Math.min(this.state.idx, len - 1));
      this.state.idx = clamped;
      this.slider.max = String(len - 1);
      this.slider.value = String(clamped);
    }
    const disableSlider = len <= 1;
    this.slider.disabled = disableSlider;
    this.playBtn.disabled = len <= 1;
    if (len <= 1) {
      this.stop();
    }
    this.renderPlayButton();
  }

  private error(msg: string) {
    this.stop();
    this.state.items = [];
    this.state.idx = 0;
    this.updateControlsForItems();
    this.preloadMap.clear();
    this.imgEl.src = '';
    this.metaEl.textContent = msg;
  }
}
