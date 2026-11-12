import { fetchEpicLatest, fetchEpicByDate, buildEpicImageUrl, extractLatestDate, type EpicItem } from '../../api/epic';
import { icon, type IconName } from '../../lib/icons';
import { hubBanner } from './banner';

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

function makeLabelHeading(text: string): HTMLElement {
  const heading = document.createElement('span');
  heading.className = 'epic-label-heading';
  heading.textContent = text;
  return heading;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11-10" as "10 November 2026". */
function longDate(isoDay: string): string {
  const [year, month, day] = isoDay.split('-').map(Number);
  return `${day} ${MONTHS[month - 1] ?? ''} ${year}`;
}

function describePoint(lat: number, lon: number): string {
  const part = (value: number, positive: string, negative: string) => `${Math.abs(value).toFixed(1)}° ${value >= 0 ? positive : negative}`;
  return `${part(lat, 'N', 'S')}, ${part(lon, 'E', 'W')}`;
}

function buttonContent(label: string, name: IconName): string {
  return `${icon(name)}<span>${label}</span>`;
}

export class EpicViewer {
  private host: HTMLElement;
  private imgEl!: HTMLImageElement;
  private slider!: HTMLInputElement;
  private playBtn!: HTMLButtonElement;
  private startInput!: HTMLInputElement;
  private endInput!: HTMLInputElement;
  private loadBtn!: HTMLButtonElement;
  private fpsSel!: HTMLSelectElement;
  private metaEl!: HTMLDivElement;
  private countEl!: HTMLSpanElement;
  private noteEl!: HTMLParagraphElement;

  private state: State = { startDate: '', endDate: '', items: [], idx: 0, playing: false, fps: 4 };
  private rafId: number | null = null;
  private lastTick = 0;
  private preloadMap = new Map<string, HTMLImageElement>(); // url → img
  private loadToken = 0;
  private readonly abort = new AbortController();

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderShell();
    this.init();
  }

  private renderShell() {
    const rangeControls = h('div', { class: 'epic-range-group' });

    const startLabel = h('label', { class: 'field', for: 'epic-start' }) as HTMLLabelElement;
    startLabel.append(makeLabelHeading('From'));
    this.startInput = h('input', { type: 'date', class: 'epic-date', id: 'epic-start' }) as HTMLInputElement;
    startLabel.append(this.startInput);

    const endLabel = h('label', { class: 'field', for: 'epic-end' }) as HTMLLabelElement;
    endLabel.append(makeLabelHeading('To'));
    this.endInput = h('input', { type: 'date', class: 'epic-date', id: 'epic-end' }) as HTMLInputElement;
    endLabel.append(this.endInput);

    this.loadBtn = h('button', { class: 'btn', type: 'button' }) as HTMLButtonElement;
    this.setLoadButtonLabel('Load these days');

    rangeControls.append(startLabel, endLabel, this.loadBtn);

    const controls = h(
      'div',
      { class: 'epic-controls' },
      (this.playBtn = h('button', { class: 'btn btn--primary', type: 'button' }) as HTMLButtonElement),
      (() => {
        const label = h('label', { class: 'field epic-speed', for: 'epic-fps' });
        label.append(makeLabelHeading('Speed'));
        this.fpsSel = h(
          'select',
          { class: 'epic-fps', id: 'epic-fps' },
          ...[2, 4, 8, 12, 24].map(v => h('option', { value: String(v) }, String(v), ' frames a second')),
        ) as HTMLSelectElement;
        label.append(this.fpsSel);
        return label;
      })(),
    );

    const timeline = h(
      'div',
      { class: 'epic-timeline' },
      (this.slider = h('input', { type: 'range', min: '0', max: '0', value: '0', class: 'epic-slider', 'aria-label': 'Frame' }) as HTMLInputElement),
      (this.countEl = h('span', { class: 'epic-count' })),
    );

    const stage = h(
      'div',
      { class: 'epic-stage' },
      (this.imgEl = h('img', { alt: 'Earth photographed by the EPIC camera', class: 'epic-image' }) as HTMLImageElement),
    );

    this.metaEl = h('div', { class: 'epic-meta', 'aria-live': 'polite' });
    this.noteEl = h('p', { class: 'epic-note', hidden: '' });

    const side = h(
      'div',
      { class: 'epic-side' },
      this.metaEl,
      timeline,
      controls,
      h('div', { class: 'epic-range' }, h('h2', {}, 'Choose the days'), rangeControls),
      this.noteEl,
    );

    const wrap = h('div', { class: 'epic-wrap' }, stage, side);
    this.host.replaceChildren(
      hubBanner(
        'EPIC Earth',
        'The whole sunlit face of Earth, photographed from the DSCOVR spacecraft 1.5 million km towards the Sun. Play a span of days and watch the planet turn.',
        'epic',
      ),
      wrap,
    );

    // Wire events
    this.refreshPlayButton();
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

  /** Stops playback and in-flight loads; call when the viewer leaves the page. */
  destroy() {
    this.loadToken += 1;
    this.abort.abort();
    this.stop();
    this.preloadMap.clear();
  }

  private get destroyed() {
    return this.abort.signal.aborted;
  }

  private async init() {
    try {
      const latest = await fetchEpicLatest(this.abort.signal);
      if (this.destroyed) return;
      const latestDate = extractLatestDate(latest);
      const end = latestDate ?? new Date().toISOString().slice(0, 10);
      // Open on the latest two days so there is a turning Earth to play straight away.
      const start = new Date(Date.parse(`${end}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
      this.startInput.value = start;
      this.endInput.value = end;
      this.startInput.max = end;
      this.endInput.max = end;
      this.syncRangeInputs();
      if (latestDate && Date.now() - Date.parse(`${latestDate}T00:00:00Z`) > 10 * DAY_MS) {
        this.noteEl.textContent = `The newest pictures in the archive are from ${longDate(latestDate)}. Nothing newer has come down from the spacecraft yet.`;
        this.noteEl.hidden = false;
      }
      await this.loadRange(start, end);
      this.setFps(4);
    } catch (err) {
      if (!this.destroyed) this.error(String(err));
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
    this.slider.disabled = true;
    this.slider.max = '0';
    this.slider.value = '0';
    this.imgEl.src = '';
    this.metaEl.textContent = 'Fetching the pictures.';
    this.countEl.textContent = '';
    this.loadBtn.disabled = true;
    this.setLoadButtonLabel('Loading…');

    try {
      const collected: EpicItem[] = [];
      for (const day of days) {
        const payload = await fetchEpicByDate(day, this.abort.signal);
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
        this.metaEl.textContent = `There are no pictures between ${longDate(normalizedStart)} and ${longDate(normalizedEnd)}.`;
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
        this.setLoadButtonLabel('Load these days');
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
    const [day, clock = ''] = it.date.split(' ');
    const centre = it.centroid_coordinates;
    this.metaEl.replaceChildren(
      h('p', { class: 'epic-meta__time' }, clock.slice(0, 5), h('span', {}, ' UTC')),
      h('p', { class: 'epic-meta__day' }, longDate(day)),
      h('p', { class: 'epic-meta__where' }, centre ? `Looking straight down on ${describePoint(centre.lat, centre.lon)}.` : ''),
    );
    this.countEl.textContent = `${idx + 1} of ${this.state.items.length}`;
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
    if (this.state.playing) this.stop();
    else this.play();
  }

  private refreshPlayButton(stateOverride?: boolean) {
    if (!this.playBtn) return;
    const playing = stateOverride ?? this.state.playing;
    const name: IconName = playing ? 'pause' : 'play';
    this.playBtn.innerHTML = buttonContent(playing ? 'Pause' : 'Play', name);
  }

  private setLoadButtonLabel(text: string) {
    if (!this.loadBtn) return;
    this.loadBtn.innerHTML = buttonContent(text, 'download');
  }

  private play() {
    if (this.state.items.length === 0 || this.playBtn.disabled) return;
    this.state.playing = true;
    this.refreshPlayButton(true);

    const loop = (ts: number) => {
      if (!this.state.playing) return;
      // Read the rate every frame so the speed selector takes effect mid-playback.
      if (this.lastTick === 0 || ts - this.lastTick >= 1000 / this.state.fps) {
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
    this.refreshPlayButton(false);
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
    this.refreshPlayButton();
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
