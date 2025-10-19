import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { imagesSearch, largestAssetUrl, type NasaImageItem, type SearchParams } from '../api/nasaImages';
import '../styles/imagesExplorer.css';

type Preset = 'apollo' | 'artemis' | 'custom';

type ExplorerState = {
  preset: Preset;
  q: string;
  page: number;
  ys?: number;
  ye?: number;
  kw: string[];
};

const HASH_PATH = '#/images/explorer';

function presetToQuery(preset: Preset): string {
  if (preset === 'apollo') return 'Apollo mission';
  if (preset === 'artemis') return 'Artemis mission';
  return '';
}

function parseHashState(): ExplorerState {
  const hash = window.location.hash ?? '';
  const match = hash.match(/^#\/?images\/explorer(?:\?(.*))?$/i);
  const params = new URLSearchParams(match?.[1] ?? '');
  const presetRaw = params.get('preset');
  const preset = presetRaw === 'apollo' || presetRaw === 'artemis' || presetRaw === 'custom' ? presetRaw : 'apollo';
  const q = params.get('q') ?? presetToQuery(preset);
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const ys = params.get('year_start');
  const ye = params.get('year_end');
  const kw = params.getAll('keywords').filter(Boolean);
  return {
    preset,
    q: q || presetToQuery(preset),
    page,
    ys: ys ? Number(ys) : undefined,
    ye: ye ? Number(ye) : undefined,
    kw,
  };
}

function writeHashState(state: ExplorerState) {
  const params = new URLSearchParams();
  params.set('preset', state.preset);
  params.set('q', state.q);
  params.set('page', String(state.page));
  if (state.ys) params.set('year_start', String(state.ys));
  if (state.ye) params.set('year_end', String(state.ye));
  for (const keyword of state.kw) {
    if (keyword) params.append('keywords', keyword);
  }
  const serialized = params.toString();
  const target = serialized ? `${HASH_PATH}?${serialized}` : HASH_PATH;
  const next = `${window.location.pathname}${window.location.search}${target}`;
  history.replaceState(null, '', next);
}

function keywordInputToList(value: string): string[] {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function formatMetaDate(value?: string) {
  return value?.slice(0, 10) ?? '';
}

function friendlyError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object' && 'status' in err && 'url' in err) {
    const status = (err as { status?: number }).status;
    return `Request failed${status ? ` (HTTP ${status})` : ''}`;
  }
  return 'Request failed';
}

export function initImagesExplorerPage(host?: HTMLElement | null) {
  const container = host ?? document.getElementById('page-host');
  if (!(container instanceof HTMLElement)) return () => undefined;

  const mount = document.createElement('div');
  mount.id = 'images-explorer-host';
  container.replaceChildren(mount);

  const root: Root = createRoot(mount);
  const previousTitle = document.title;
  document.title = 'Mission Image Explorer • NASA Open APIs Visualization Hub';

  root.render(<ImagesExplorer />);

  return () => {
    root.unmount();
    document.title = previousTitle;
  };
}

export default function ImagesExplorer() {
  const initial = useMemo(() => parseHashState(), []);
  const [preset, setPreset] = useState<Preset>(initial.preset);
  const [q, setQ] = useState(initial.q);
  const [page, setPage] = useState(initial.page);
  const [ys, setYs] = useState<number | undefined>(initial.ys);
  const [ye, setYe] = useState<number | undefined>(initial.ye);
  const [kwInput, setKwInput] = useState(initial.kw.join(', '));
  const [items, setItems] = useState<NasaImageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrev, setHasPrev] = useState(false);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<NasaImageItem | null>(null);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    writeHashState({ preset, q, page, ys, ye, kw: keywordInputToList(kwInput) });
  }, [preset, q, page, ys, ye, kwInput]);

  useEffect(() => {
    const params: SearchParams = {
      q,
      page,
      year_start: ys,
      year_end: ye,
      keywords: keywordInputToList(kwInput),
    };
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    imagesSearch(params, { signal: controller.signal })
      .then(result => {
        if (cancelled) return;
        setItems(result.items);
        setHasNext(result.hasNext);
        setHasPrev(result.hasPrev || page > 1);
        setTotal(result.total);
      })
      .catch(err => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setError(friendlyError(err));
        setItems([]);
        setHasNext(false);
        setHasPrev(page > 1);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [q, page, ys, ye, kwInput]);

  useEffect(() => {
    if (!selected) {
      setFullUrl(null);
      return;
    }
    const controller = new AbortController();
    setFullUrl(null);
    largestAssetUrl(selected.nasa_id, controller.signal)
      .then(url => {
        if (!controller.signal.aborted) {
          setFullUrl(url);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFullUrl(null);
        }
      });
    return () => {
      controller.abort();
    };
  }, [selected]);

  useEffect(() => {
    const handler = () => {
      const next = parseHashState();
      setPreset(next.preset);
      setQ(next.q);
      setPage(next.page);
      setYs(next.ys);
      setYe(next.ye);
      setKwInput(next.kw.join(', '));
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  useEffect(() => {
    if (!selected && previouslyFocused.current) {
      previouslyFocused.current.focus();
      previouslyFocused.current = null;
    }
  }, [selected]);

  useEffect(() => {
    if (!selected || !modalRef.current) {
      return;
    }
    const modalNode = modalRef.current;
    const focusableSelectors =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(modalNode.querySelectorAll<HTMLElement>(focusableSelectors)).filter(element =>
        !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
      );
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelected(null);
        return;
      }
      if (event.key === 'Tab') {
        const focusables = getFocusable();
        if (!focusables.length) {
          event.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeydown);
    const focusables = getFocusable();
    (focusables[0] ?? closeButtonRef.current)?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', handleKeydown);
    };
  }, [selected]);

  return (
    <div className="images-explorer">
      <h1 className="images-explorer__heading">Mission Image Explorer</h1>

      <div className="images-explorer__presets">
        {(['apollo', 'artemis', 'custom'] as Preset[]).map(current => (
          <button
            key={current}
            className={`images-explorer__preset${preset === current ? ' is-active' : ''}`}
            onClick={() => {
              setPreset(current);
              const baseQuery = presetToQuery(current);
              setQ(current === 'custom' ? q : baseQuery);
              setPage(1);
            }}
            type="button"
          >
            {current[0].toUpperCase() + current.slice(1)}
          </button>
        ))}
      </div>

      <form
        className="images-explorer__form"
        onSubmit={event => {
          event.preventDefault();
          setPage(1);
        }}
      >
        <input
          className="images-explorer__input"
          value={q}
          onChange={event => setQ(event.target.value)}
          placeholder="Search..."
        />
        <input
          className="images-explorer__input"
          value={ys ?? ''}
          onChange={event => {
            const value = event.target.value.trim();
            setYs(value ? Number(value) : undefined);
          }}
          placeholder="Year start"
        />
        <input
          className="images-explorer__input"
          value={ye ?? ''}
          onChange={event => {
            const value = event.target.value.trim();
            setYe(value ? Number(value) : undefined);
          }}
          placeholder="Year end"
        />
        <input
          className="images-explorer__input"
          value={kwInput}
          onChange={event => setKwInput(event.target.value)}
          placeholder="Keywords (comma-separated)"
        />
        <button className="images-explorer__submit" type="submit">
          Apply
        </button>
      </form>

      <div className="images-explorer__status" role="status" aria-live="polite">
        {loading ? 'Loading…' : error ? error : `${total.toLocaleString()} results`}
      </div>

      {!loading && !error && items.length === 0 && (
        <div className="images-explorer__empty">No results. Adjust your filters and try again.</div>
      )}

      <div className="images-explorer__grid">
        {items.map(item => (
          <button
            key={item.nasa_id || item.title}
            className="images-explorer__card"
            onClick={event => {
              previouslyFocused.current = event.currentTarget;
              setSelected(item);
            }}
            title={item.title}
            type="button"
          >
            {item.thumb ? (
              <img
                className="images-explorer__thumb"
                src={item.thumb}
                alt={item.title}
                loading="lazy"
              />
            ) : (
              <div className="images-explorer__thumb images-explorer__thumb--placeholder" />
            )}
            <div className="images-explorer__card-body">
              <div className="images-explorer__card-title">{item.title}</div>
              <div className="images-explorer__card-meta">
                {formatMetaDate(item.date_created)}
                {item.photographer ? ` • ${item.photographer}` : ''}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="images-explorer__pagination">
        <button
          className="images-explorer__page-button"
          disabled={!hasPrev || loading}
          onClick={() => setPage(current => Math.max(1, current - 1))}
          type="button"
        >
          Prev
        </button>
        <span className="images-explorer__page-indicator">Page {page}</span>
        <button
          className="images-explorer__page-button"
          disabled={!hasNext || loading}
          onClick={() => setPage(current => current + 1)}
          type="button"
        >
          Next
        </button>
      </div>

      {selected && (
        <div
          className="images-explorer__modal-overlay"
          onClick={() => setSelected(null)}
          role="presentation"
        >
          <div
            className="images-explorer__modal"
            ref={modalRef}
            onClick={event => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="images-explorer-modal-title"
            aria-describedby={selected.description ? 'images-explorer-modal-description' : undefined}
          >
            <div className="images-explorer__modal-header">
              <strong className="images-explorer__modal-title" id="images-explorer-modal-title">
                {selected.title}
              </strong>
              <span className="images-explorer__modal-meta">
                {formatMetaDate(selected.date_created)}
                {selected.photographer ? ` • ${selected.photographer}` : ''}
              </span>
              <button
                className="images-explorer__modal-close"
                onClick={() => setSelected(null)}
                ref={closeButtonRef}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="images-explorer__modal-body">
              {fullUrl ? (
                <img
                  className="images-explorer__modal-image"
                  src={fullUrl}
                  alt={selected.title}
                />
              ) : (
                <div className="images-explorer__modal-loading">Loading full-resolution…</div>
              )}
              {selected.description && (
                <p className="images-explorer__modal-description" id="images-explorer-modal-description">
                  {selected.description}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
