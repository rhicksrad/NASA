import { useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { imagesSearch, largestAssetUrl, type NasaImageItem, type SearchParams } from '../api/nasaImages';

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
  mount.style.width = '100%';
  mount.style.minHeight = '100%';
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
    setLoading(true);
    setError(null);
    imagesSearch(params)
      .then(result => {
        if (cancelled) return;
        setItems(result.items);
        setHasNext(result.hasNext);
        setHasPrev(result.hasPrev || page > 1);
        setTotal(result.total);
      })
      .catch(err => {
        if (cancelled) return;
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
    };
  }, [q, page, ys, ye, kwInput]);

  useEffect(() => {
    if (!selected) {
      setFullUrl(null);
      return;
    }
    let cancelled = false;
    largestAssetUrl(selected.nasa_id)
      .then(url => {
        if (!cancelled) setFullUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFullUrl(null);
      });
    return () => {
      cancelled = true;
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

  return (
    <div style={{ padding: '16px', color: '#e5e7eb' }}>
      <h1 style={{ margin: '0 0 12px 0', fontSize: 24 }}>Mission Image Explorer</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['apollo', 'artemis', 'custom'] as Preset[]).map(current => (
          <button
            key={current}
            onClick={() => {
              setPreset(current);
              const baseQuery = presetToQuery(current);
              setQ(current === 'custom' ? q : baseQuery);
              setPage(1);
            }}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid #1f2937',
              background: preset === current ? '#1f2937' : '#0b1220',
              color: '#e5e7eb',
              cursor: 'pointer',
            }}
            type="button"
          >
            {current[0].toUpperCase() + current.slice(1)}
          </button>
        ))}
      </div>

      <form
        onSubmit={event => {
          event.preventDefault();
          setPage(1);
        }}
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr 2fr auto',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <input
          value={q}
          onChange={event => setQ(event.target.value)}
          placeholder="Search..."
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #374151',
            background: '#0b1220',
            color: '#e5e7eb',
          }}
        />
        <input
          value={ys ?? ''}
          onChange={event => {
            const value = event.target.value.trim();
            setYs(value ? Number(value) : undefined);
          }}
          placeholder="Year start"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #374151',
            background: '#0b1220',
            color: '#e5e7eb',
          }}
        />
        <input
          value={ye ?? ''}
          onChange={event => {
            const value = event.target.value.trim();
            setYe(value ? Number(value) : undefined);
          }}
          placeholder="Year end"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #374151',
            background: '#0b1220',
            color: '#e5e7eb',
          }}
        />
        <input
          value={kwInput}
          onChange={event => setKwInput(event.target.value)}
          placeholder="Keywords (comma-separated)"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #374151',
            background: '#0b1220',
            color: '#e5e7eb',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #1f2937',
            background: '#111827',
            color: '#cbd5e1',
            cursor: 'pointer',
          }}
        >
          Apply
        </button>
      </form>

      <div style={{ marginBottom: 8, opacity: 0.8 }}>
        {loading ? 'Loading…' : error ? error : `${total.toLocaleString()} results`}
      </div>

      {!loading && !error && items.length === 0 && (
        <div style={{ marginBottom: 16, color: '#cbd5e1' }}>No results. Adjust your filters and try again.</div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 12,
        }}
      >
        {items.map(item => (
          <button
            key={item.nasa_id || item.title}
            onClick={() => setSelected(item)}
            title={item.title}
            type="button"
            style={{
              display: 'block',
              background: '#0b1220',
              border: '1px solid #1f2937',
              borderRadius: 12,
              padding: 0,
              cursor: 'zoom-in',
              overflow: 'hidden',
            }}
          >
            {item.thumb ? (
              <img
                src={item.thumb}
                alt={item.title}
                style={{ display: 'block', width: '100%', height: 150, objectFit: 'cover' }}
                loading="lazy"
              />
            ) : (
              <div style={{ width: '100%', height: 150, background: '#111827' }} />
            )}
            <div style={{ padding: '8px 10px' }}>
              <div style={{ fontSize: 13, lineHeight: 1.3, marginBottom: 4, color: '#e5e7eb' }}>{item.title}</div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>
                {formatMetaDate(item.date_created)}
                {item.photographer ? ` • ${item.photographer}` : ''}
              </div>
            </div>
          </button>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 16,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <button
          disabled={!hasPrev || loading}
          onClick={() => setPage(current => Math.max(1, current - 1))}
          type="button"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #1f2937',
            background: '#0b1220',
            color: '#e5e7eb',
            opacity: !hasPrev || loading ? 0.5 : 1,
            cursor: !hasPrev || loading ? 'default' : 'pointer',
          }}
        >
          Prev
        </button>
        <span style={{ opacity: 0.8 }}>Page {page}</span>
        <button
          disabled={!hasNext || loading}
          onClick={() => setPage(current => current + 1)}
          type="button"
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #1f2937',
            background: '#0b1220',
            color: '#e5e7eb',
            opacity: !hasNext || loading ? 0.5 : 1,
            cursor: !hasNext || loading ? 'default' : 'pointer',
          }}
        >
          Next
        </button>
      </div>

      {selected && (
        <div
          onClick={() => setSelected(null)}
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'grid',
            placeItems: 'center',
            padding: 20,
            zIndex: 1000,
            cursor: 'zoom-out',
          }}
        >
          <div
            onClick={event => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{
              maxWidth: 'min(92vw, 1400px)',
              maxHeight: '90vh',
              background: '#0b1220',
              border: '1px solid #1f2937',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderBottom: '1px solid #1f2937',
              }}
            >
              <strong style={{ color: '#e5e7eb' }}>{selected.title}</strong>
              <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: 12 }}>
                {formatMetaDate(selected.date_created)}
                {selected.photographer ? ` • ${selected.photographer}` : ''}
              </span>
              <button
                onClick={() => setSelected(null)}
                type="button"
                style={{
                  marginLeft: 12,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid #374151',
                  background: '#111827',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ padding: 12 }}>
              {fullUrl ? (
                <img
                  src={fullUrl}
                  alt={selected.title}
                  style={{ display: 'block', maxWidth: '100%', maxHeight: '75vh', objectFit: 'contain' }}
                />
              ) : (
                <div style={{ padding: 20, color: '#9ca3af' }}>Loading full-resolution…</div>
              )}
              {selected.description && (
                <p style={{ color: '#cbd5e1', marginTop: 12, whiteSpace: 'pre-wrap' }}>{selected.description}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
