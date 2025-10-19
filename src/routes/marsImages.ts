import '../styles/mars.css';
import { searchImages, bestThumb, type ImagesSearchResult, type NasaImagesItem } from '../api/imagesClient';

type Rover = 'Curiosity' | 'Perseverance' | 'Opportunity' | 'Spirit';
type InstrumentKey = 'mastcam' | 'mastcam-z' | 'navcam' | 'mahli' | 'mardi' | 'hazcam' | 'any';

type MarsState = {
  rover: Rover;
  instrument: InstrumentKey;
  sol: string;
  year: string;
  page: number;
};

const ROVERS: Rover[] = ['Curiosity', 'Perseverance', 'Opportunity', 'Spirit'];

const INSTRUMENT_TOKENS: Record<InstrumentKey, string> = {
  'mastcam': 'Mastcam',
  'mastcam-z': 'Mastcam-Z',
  'navcam': 'Navcam',
  'mahli': 'Mars Hand Lens Imager',
  'mardi': 'Mars Descent Imager',
  'hazcam': 'Hazcam',
  'any': '',
};

const INSTRUMENT_LABELS: Record<InstrumentKey, string> = {
  'mastcam': 'Mastcam (Curiosity)',
  'mastcam-z': 'Mastcam-Z (Perseverance)',
  'navcam': 'Navcam',
  'mahli': 'MAHLI',
  'mardi': 'MARDI',
  'hazcam': 'Hazcam',
  'any': 'Any',
};

function composeQuery(rover: Rover, instrument: InstrumentKey, solText: string): string {
  const roverToken = rover;
  const instrumentToken = (INSTRUMENT_TOKENS[instrument] ?? '').trim();
  const parts: string[] = [roverToken];
  if (instrumentToken) parts.push(instrumentToken);
  if (solText && solText.trim().length > 0) {
    parts.push(`Sol ${solText.trim()}`);
  }
  return parts.join(' ');
}

function parseHashState(): MarsState {
  const hash = window.location.hash || '#/mars';
  const [, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);

  const rover = (params.get('rover') as Rover) || 'Curiosity';
  const roverValid = ROVERS.includes(rover) ? rover : 'Curiosity';

  const instrumentParam = (params.get('instrument') as InstrumentKey) || 'mastcam';
  const instrumentValid: InstrumentKey = instrumentParam in INSTRUMENT_TOKENS ? instrumentParam : 'mastcam';

  const sol = params.get('sol') ?? '';
  const year = params.get('year') ?? '';
  const pageRaw = params.get('page');
  const page = pageRaw ? Math.max(1, Number.parseInt(pageRaw, 10) || 1) : 1;

  return {
    rover: roverValid,
    instrument: instrumentValid,
    sol,
    year,
    page,
  };
}

function formatDate(value?: string): string {
  if (!value) return '';
  const iso = value.slice(0, 10);
  return iso;
}

function truncate(text: string, maxLength = 600): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function buildQueryFromState(state: MarsState): string {
  const params = new URLSearchParams();
  params.set('rover', state.rover);
  params.set('instrument', state.instrument);
  if (state.sol.trim()) {
    params.set('sol', state.sol.trim());
  }
  if (state.year.trim()) {
    params.set('year', state.year.trim());
  }
  if (state.page > 1) {
    params.set('page', String(state.page));
  }
  const serialized = params.toString();
  return serialized ? `#/mars?${serialized}` : '#/mars';
}

type RenderContext = {
  gridEl: HTMLDivElement;
  statusEl: HTMLDivElement;
  statusMessageEl: HTMLSpanElement;
  noteEl: HTMLDivElement;
  totalEl: HTMLSpanElement;
  errorEl: HTMLDivElement;
  modalOverlay: HTMLDivElement;
  modalImage: HTMLImageElement;
  modalTitle: HTMLHeadingElement;
  modalDescription: HTMLParagraphElement;
  modalOpenLink: HTMLAnchorElement;
  modalCloseBtn: HTMLButtonElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  pageBadge: HTMLSpanElement;
  lastTrigger: HTMLElement | null;
};

function renderGrid(context: RenderContext, items: NasaImagesItem[]): void {
  context.gridEl.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No images found for this query.';
    context.gridEl.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const firstDatum = item.data?.[0];
    const title = firstDatum?.title ?? 'Untitled';
    const date = formatDate(firstDatum?.date_created);
    const thumb = bestThumb(item);

    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'mars-tile';

    if (thumb) {
      const img = document.createElement('img');
      img.src = thumb;
      img.alt = title;
      img.loading = 'lazy';
      img.className = 'mars-thumb';
      tile.appendChild(img);
    }

    const meta = document.createElement('div');
    meta.className = 'mars-meta';

    const titleEl = document.createElement('h3');
    titleEl.textContent = title;
    meta.appendChild(titleEl);

    if (date) {
      const time = document.createElement('time');
      time.dateTime = date;
      time.textContent = date;
      meta.appendChild(time);
    }

    tile.appendChild(meta);

    tile.addEventListener('click', () => openModal(context, item, tile));

    fragment.appendChild(tile);
  }

  context.gridEl.appendChild(fragment);
}

function openModal(context: RenderContext, item: NasaImagesItem, trigger: HTMLElement): void {
  const firstDatum = item.data?.[0];
  const title = firstDatum?.title ?? 'Mars image';
  const description = firstDatum?.description ? truncate(firstDatum.description) : 'No description available.';
  const linkHref = firstDatum?.nasa_id
    ? `https://images.nasa.gov/details/${encodeURIComponent(firstDatum.nasa_id)}`
    : item.href;
  const displayHref = bestThumb(item);

  context.lastTrigger = trigger;

  if (displayHref) {
    context.modalImage.src = displayHref;
  } else {
    context.modalImage.removeAttribute('src');
  }

  context.modalImage.alt = title;
  context.modalTitle.textContent = title;
  context.modalDescription.textContent = description;
  context.modalOpenLink.href = linkHref;

  context.modalOverlay.classList.remove('mars-hidden');
  context.modalCloseBtn.focus({ preventScroll: true });
}

function closeModal(context: RenderContext): void {
  context.modalOverlay.classList.add('mars-hidden');
  context.modalImage.removeAttribute('src');
  const trigger = context.lastTrigger;
  if (trigger) {
    trigger.focus({ preventScroll: true });
  }
  context.lastTrigger = null;
}

function buildModal(): {
  overlay: HTMLDivElement;
  image: HTMLImageElement;
  title: HTMLHeadingElement;
  description: HTMLParagraphElement;
  openLink: HTMLAnchorElement;
  closeBtn: HTMLButtonElement;
} {
  const overlay = document.createElement('div');
  overlay.className = 'mars-modal-overlay mars-hidden';

  const modal = document.createElement('div');
  modal.className = 'mars-modal';
  overlay.appendChild(modal);

  const image = document.createElement('img');
  image.alt = '';
  modal.appendChild(image);

  const content = document.createElement('div');
  content.className = 'mars-modal-content';
  modal.appendChild(content);

  const title = document.createElement('h2');
  content.appendChild(title);

  const description = document.createElement('p');
  content.appendChild(description);

  const actions = document.createElement('div');
  actions.className = 'mars-modal-actions';
  content.appendChild(actions);

  const openLink = document.createElement('a');
  openLink.textContent = 'Open on NASA';
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  openLink.className = 'button';
  actions.appendChild(openLink);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  actions.appendChild(closeBtn);

  return { overlay, image, title, description, openLink, closeBtn };
}

export function mountMarsPage(host?: HTMLElement | null): () => void {
  const container = host ?? document.getElementById('page-host');
  if (!(container instanceof HTMLElement)) {
    return () => undefined;
  }

  const root = document.createElement('div');
  root.id = 'mars-root';
  container.replaceChildren(root);

  const heading = document.createElement('h1');
  heading.textContent = 'Mars Rover Images';
  heading.style.marginBottom = '12px';
  root.appendChild(heading);

  const controls = document.createElement('div');
  controls.className = 'mars-controls';
  root.appendChild(controls);

  const roverLabel = document.createElement('label');
  roverLabel.textContent = 'Rover';
  const roverSelect = document.createElement('select');
  roverSelect.name = 'rover';
  for (const rover of ROVERS) {
    const option = document.createElement('option');
    option.value = rover;
    option.textContent = rover;
    roverSelect.appendChild(option);
  }
  roverLabel.appendChild(roverSelect);
  controls.appendChild(roverLabel);

  const instrumentLabel = document.createElement('label');
  instrumentLabel.textContent = 'Instrument';
  const instrumentSelect = document.createElement('select');
  instrumentSelect.name = 'instrument';
  (Object.keys(INSTRUMENT_LABELS) as InstrumentKey[]).forEach(key => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = INSTRUMENT_LABELS[key];
    instrumentSelect.appendChild(option);
  });
  instrumentLabel.appendChild(instrumentSelect);
  controls.appendChild(instrumentLabel);

  const solLabel = document.createElement('label');
  solLabel.textContent = 'Sol text';
  const solInput = document.createElement('input');
  solInput.type = 'number';
  solInput.name = 'sol';
  solInput.placeholder = 'e.g. 1000';
  solLabel.appendChild(solInput);
  controls.appendChild(solLabel);

  const yearLabel = document.createElement('label');
  yearLabel.textContent = 'Year';
  const yearInput = document.createElement('input');
  yearInput.type = 'number';
  yearInput.name = 'year';
  yearInput.placeholder = 'YYYY';
  yearLabel.appendChild(yearInput);
  controls.appendChild(yearLabel);

  const pageControls = document.createElement('div');
  pageControls.className = 'mars-page-controls';
  root.appendChild(pageControls);

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.textContent = 'Prev';
  pageControls.appendChild(prevBtn);

  const pageBadge = document.createElement('span');
  pageBadge.textContent = 'Page 1';
  pageControls.appendChild(pageBadge);

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.textContent = 'Next';
  pageControls.appendChild(nextBtn);

  const statusEl = document.createElement('div');
  statusEl.className = 'mars-status';
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  root.appendChild(statusEl);

  const statusMessageEl = document.createElement('span');
  statusMessageEl.className = 'mars-status-message';
  statusEl.appendChild(statusMessageEl);

  const totalEl = document.createElement('span');
  totalEl.className = 'mars-total';
  statusEl.appendChild(totalEl);

  const noteEl = document.createElement('div');
  noteEl.className = 'mars-broad-note mars-hidden';
  root.appendChild(noteEl);

  const errorEl = document.createElement('div');
  errorEl.className = 'mars-error mars-hidden';
  root.appendChild(errorEl);

  const grid = document.createElement('div');
  grid.className = 'mars-grid';
  root.appendChild(grid);

  const modal = buildModal();
  root.appendChild(modal.overlay);

  const context: RenderContext = {
    gridEl: grid,
    statusEl,
    statusMessageEl,
    noteEl,
    totalEl,
    errorEl,
    modalOverlay: modal.overlay,
    modalImage: modal.image,
    modalTitle: modal.title,
    modalDescription: modal.description,
    modalOpenLink: modal.openLink,
    modalCloseBtn: modal.closeBtn,
    prevBtn,
    nextBtn,
    pageBadge,
    lastTrigger: null,
  };

  const closeModalHandler = (evt: Event) => {
    evt.stopPropagation();
    closeModal(context);
  };

  modal.closeBtn.addEventListener('click', closeModalHandler);
  const overlayClickHandler = (evt: MouseEvent) => {
    if (evt.target === modal.overlay) {
      closeModal(context);
    }
  };
  modal.overlay.addEventListener('click', overlayClickHandler);
  const keydownHandler = (evt: KeyboardEvent) => {
    if (evt.key === 'Escape' && !modal.overlay.classList.contains('mars-hidden')) {
      closeModal(context);
    }
  };
  window.addEventListener('keydown', keydownHandler);

  let state = parseHashState();
  let activeRequest = 0;

  const updateControlsFromState = (value: MarsState) => {
    roverSelect.value = value.rover;
    instrumentSelect.value = value.instrument;
    solInput.value = value.sol;
    yearInput.value = value.year;
    pageBadge.textContent = `Page ${value.page}`;
  };

  updateControlsFromState(state);

  const updateHash = (value: MarsState, push: boolean) => {
    const target = buildQueryFromState(value);
    if (window.location.hash === target.replace(/^#/, '#')) {
      return;
    }
    const fullUrl = `${window.location.pathname}${window.location.search}${target}`;
    if (push) {
      window.history.pushState(null, '', fullUrl);
    } else {
      window.history.replaceState(null, '', fullUrl);
    }
  };

  const setNoteVisible = (visible: boolean) => {
    if (visible) {
      noteEl.classList.remove('mars-hidden');
      noteEl.textContent = 'No results with instrument filter; broadened search.';
    } else {
      noteEl.classList.add('mars-hidden');
      noteEl.textContent = '';
    }
  };

  const setError = (message: string | null) => {
    if (message) {
      errorEl.textContent = message;
      errorEl.classList.remove('mars-hidden');
    } else {
      errorEl.textContent = '';
      errorEl.classList.add('mars-hidden');
    }
  };

  const setLoading = (loading: boolean) => {
    if (loading) {
      statusMessageEl.textContent = 'Loading images…';
    } else {
      statusMessageEl.textContent = '';
    }
  };

  const runSearch = async (current: MarsState) => {
    const requestId = ++activeRequest;
    setLoading(true);
    setError(null);
    setNoteVisible(false);
    const q = composeQuery(current.rover, current.instrument, current.sol);
    const params: Parameters<typeof searchImages>[0] = {
      q,
      media_type: 'image',
      page: current.page,
    };
    const trimmedYear = current.year.trim();
    if (trimmedYear) {
      params.year_start = trimmedYear;
      params.year_end = trimmedYear;
    }

    try {
      let result: ImagesSearchResult = await searchImages(params);
      let broadened = false;
      if (result.total === 0 && current.instrument !== 'any') {
        broadened = true;
        const params2 = { ...params, q: composeQuery(current.rover, 'any', current.sol) };
        result = await searchImages(params2);
      }
      if (requestId !== activeRequest) {
        return;
      }
      const pageSize = result.items.length || 100;
      const totalPages = pageSize ? Math.max(1, Math.ceil(result.total / pageSize)) : current.page;
      prevBtn.disabled = current.page <= 1;
      nextBtn.disabled = current.page >= totalPages || !result.items.length;
      pageBadge.textContent = `Page ${current.page}`;
      if (result.total > 0) {
        totalEl.textContent = `Total hits: ${result.total.toLocaleString()}`;
      } else if (result.items.length > 0) {
        totalEl.textContent = `Showing ${result.items.length} results`;
      } else {
        totalEl.textContent = 'No results';
      }
      setNoteVisible(broadened);
      renderGrid(context, result.items);
    } catch (err) {
      if (requestId !== activeRequest) {
        return;
      }
      prevBtn.disabled = current.page <= 1;
      nextBtn.disabled = true;
      context.gridEl.replaceChildren();
      const status = typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined;
      const message = status ? `Images search failed (HTTP ${status}).` : 'Images search failed.';
      setError(message);
      totalEl.textContent = '';
    } finally {
      if (requestId === activeRequest) {
        setLoading(false);
      }
    }
  };

  const applyState = (updater: (current: MarsState) => MarsState, pushHistory: boolean) => {
    const nextState = updater(state);
    state = nextState;
    updateControlsFromState(nextState);
    updateHash(nextState, pushHistory);
    void runSearch(nextState);
  };

  roverSelect.addEventListener('change', () => {
    applyState(prev => ({ ...prev, rover: roverSelect.value as Rover, page: 1 }), true);
  });

  instrumentSelect.addEventListener('change', () => {
    applyState(prev => ({ ...prev, instrument: instrumentSelect.value as InstrumentKey, page: 1 }), true);
  });

  solInput.addEventListener('change', () => {
    applyState(prev => ({ ...prev, sol: solInput.value.trim(), page: 1 }), true);
  });

  yearInput.addEventListener('change', () => {
    applyState(prev => ({ ...prev, year: yearInput.value.trim(), page: 1 }), true);
  });

  prevBtn.addEventListener('click', () => {
    if (state.page <= 1) return;
    applyState(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }), true);
  });

  nextBtn.addEventListener('click', () => {
    applyState(prev => ({ ...prev, page: prev.page + 1 }), true);
  });

  const popStateHandler = () => {
    const parsed = parseHashState();
    state = parsed;
    updateControlsFromState(parsed);
    void runSearch(parsed);
  };
  window.addEventListener('popstate', popStateHandler);

  updateHash(state, false);
  void runSearch(state);

  return () => {
    window.removeEventListener('popstate', popStateHandler);
    modal.closeBtn.removeEventListener('click', closeModalHandler);
    modal.overlay.removeEventListener('click', overlayClickHandler);
    window.removeEventListener('keydown', keydownHandler);
  };
}
