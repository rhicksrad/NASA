import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  fetchAssetManifest,
  nextPageFrom,
  searchImages,
  type AssetManifestEntry,
  type MediaType,
  type NasaImageItem,
} from '../api/images';

// ---------- Routing bootstrap ----------
export function initImagesPage(host?: HTMLElement | null) {
  const container = host ?? document.getElementById('page-host');
  if (!(container instanceof HTMLElement)) return () => undefined;

  const mount = document.createElement('div');
  mount.id = 'images-route-host';
  mount.style.width = '100%';
  mount.style.minHeight = '100%';
  container.replaceChildren(mount);

  const root: Root = createRoot(mount);
  const previousTitle = document.title;
  document.title = 'NASA Image Explorer • NASA Open APIs Visualization Hub';

  root.render(<ImagesPage />);

  return () => {
    root.unmount();
    document.title = previousTitle;
  };
}

// ---------- React components ----------
type QueryState = {
  q: string;
  media_type: MediaType | '';
  year_start: string;
  year_end: string;
  center: string;
};

const suggestionQueries = ['Perseverance', 'Artemis', 'Pillars of Creation', 'JWST'];

function readHash(): QueryState {
  const hash = window.location.hash ?? '';
  const match = hash.match(/^#\/?images(?:\?(.*))?$/i);
  const params = new URLSearchParams(match?.[1] ?? '');
  const media = params.get('media_type');
  const mediaTyped = media === 'image' || media === 'video' || media === 'audio' ? (media as MediaType) : '';
  return {
    q: params.get('q') ?? '',
    media_type: mediaTyped,
    year_start: params.get('year_start') ?? '',
    year_end: params.get('year_end') ?? '',
    center: params.get('center') ?? '',
  };
}

function writeHash(state: QueryState) {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.media_type) params.set('media_type', state.media_type);
  if (state.year_start.trim()) params.set('year_start', state.year_start.trim());
  if (state.year_end.trim()) params.set('year_end', state.year_end.trim());
  if (state.center.trim()) params.set('center', state.center.trim());
  const serialized = params.toString();
  const target = serialized ? `#/images?${serialized}` : '#/images';
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

function sanitizeQuery(state: QueryState): QueryState {
  const clampYear = (value: string) => value.replace(/[^0-9]/g, '').slice(0, 4);
  return {
    q: state.q.trim(),
    media_type: state.media_type,
    year_start: clampYear(state.year_start),
    year_end: clampYear(state.year_end),
    center: state.center.trim(),
  };
}

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export default function ImagesPage() {
  const [query, setQuery] = useState<QueryState>(() => readHash());
  const [applied, setApplied] = useState<QueryState>(() => readHash());
  const [items, setItems] = useState<NasaImageItem[]>([]);
  const [page, setPage] = useState(1);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<NasaImageItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const appliedKey = useMemo(
    () => `${applied.q}|${applied.media_type}|${applied.year_start}|${applied.year_end}|${applied.center}`,
    [applied],
  );

  const canSearch = applied.q.trim().length > 0;

  useEffect(() => {
    const handler = () => {
      const nextState = readHash();
      setQuery(nextState);
      setApplied(nextState);
      setPage(1);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  useEffect(() => {
    writeHash(applied);
  }, [applied]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!canSearch) {
        if (page !== 1) setPage(1);
        setItems([]);
        setNextPage(null);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await searchImages({
          q: applied.q,
          media_type: applied.media_type || undefined,
          year_start: applied.year_start ? Number(applied.year_start) : undefined,
          year_end: applied.year_end ? Number(applied.year_end) : undefined,
          center: applied.center || undefined,
          page,
        });
        if (cancelled) return;
        setItems(prev => (page === 1 ? result.collection.items : prev.concat(result.collection.items)));
        const next = nextPageFrom(result);
        setNextPage(next);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Search failed';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run().catch(() => {
      /* handled above */
    });
    return () => {
      cancelled = true;
    };
  }, [appliedKey, page, canSearch, applied.q, applied.media_type, applied.year_start, applied.year_end, applied.center]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (!nextPage || !canSearch) return;

    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !loading && nextPage !== page) {
          setPage(nextPage);
        }
      });
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextPage, loading, page, canSearch]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sanitized = sanitizeQuery(query);
    setQuery(sanitized);
    setApplied(sanitized);
    setPage(1);
  };

  const onMediaTypeChange = (event: FormEvent<HTMLSelectElement>) => {
    const value = (event.currentTarget.value || '') as MediaType | '';
    setQuery(prev => ({ ...prev, media_type: value }));
  };

  const openItem = useCallback((item: NasaImageItem) => setActive(item), []);

  return (
    <div className="images-page" style={pageStyle}>
      <h1 style={titleStyle}>NASA Image Explorer</h1>
      <form onSubmit={onSubmit} style={formStyle}>
        <input
          value={query.q}
          onChange={event => setQuery(prev => ({ ...prev, q: event.currentTarget.value }))}
          placeholder="Search (e.g., Eros, Apollo 11, Pillars of Creation)"
          aria-label="Search"
          style={inputStyle}
        />
        <select value={query.media_type} onChange={onMediaTypeChange} title="Media Type" style={inputStyle}>
          <option value="">Any</option>
          <option value="image">Images</option>
          <option value="video">Video</option>
          <option value="audio">Audio</option>
        </select>
        <input
          value={query.year_start}
          onChange={event => setQuery(prev => ({ ...prev, year_start: event.currentTarget.value }))}
          placeholder="Year start"
          inputMode="numeric"
          style={inputStyle}
        />
        <input
          value={query.year_end}
          onChange={event => setQuery(prev => ({ ...prev, year_end: event.currentTarget.value }))}
          placeholder="Year end"
          inputMode="numeric"
          style={inputStyle}
        />
        <input
          value={query.center}
          onChange={event => setQuery(prev => ({ ...prev, center: event.currentTarget.value }))}
          placeholder="Center (e.g. JSC)"
          style={inputStyle}
        />
        <button type="submit" style={buttonStyle}>
          Search
        </button>
      </form>

      {error && (
        <div style={errorStyle} role="alert">
          {error}
        </div>
      )}

      {!canSearch && (
        <p style={hintStyle}>
          Try: {suggestionQueries.map((text, index) => (
            <span key={text}>
              <em>{text}</em>
              {index < suggestionQueries.length - 1 ? ', ' : ''}
            </span>
          ))}
          .
        </p>
      )}

      <div style={gridStyle}>
        {items.map(item => {
          const meta = item.data?.[0];
          const thumb = item.links?.find(link => link.render === 'image')?.href ?? item.links?.[0]?.href;
          const taken = formatDate(meta?.date_created);
          return (
            <button
              key={meta?.nasa_id ?? item.href}
              onClick={() => openItem(item)}
              title={meta?.title || meta?.nasa_id || 'Open'}
              style={cardStyle}
            >
              {thumb ? (
                <img src={thumb} alt={meta?.title || 'thumbnail'} style={thumbnailStyle} loading="lazy" />
              ) : (
                <div style={placeholderStyle} aria-hidden="true" />
              )}
              <div style={cardBodyStyle}>
                <div style={cardTitleStyle}>{meta?.title || meta?.nasa_id}</div>
                {taken && <div style={cardMetaStyle}>{taken}</div>}
                {meta?.center && <div style={cardMetaStyle}>Center: {meta.center}</div>}
              </div>
            </button>
          );
        })}
      </div>

      <div ref={sentinelRef} style={{ height: 1 }} />

      {loading && canSearch && (
        <div style={loadingStyle}>Loading…</div>
      )}

      {active && <AssetModal item={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function AssetModal({ item, onClose }: { item: NasaImageItem; onClose: () => void }) {
  const meta = item.data?.[0];
  const [assets, setAssets] = useState<AssetManifestEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAssets(null);
    setError(null);
    (async () => {
      try {
        const result = await fetchAssetManifest(item.href);
        if (!cancelled) setAssets(result);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load asset files';
        setError(message);
      }
    })().catch(() => {
      /* handled */
    });
    return () => {
      cancelled = true;
    };
  }, [item.href]);

  useEffect(() => {
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', keyHandler);
    return () => window.removeEventListener('keydown', keyHandler);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" style={modalOverlayStyle} onClick={onClose}>
      <div
        onClick={event => event.stopPropagation()}
        style={modalStyle}
      >
        <div style={modalHeaderStyle}>
          <h2 style={modalTitleStyle}>{meta?.title || meta?.nasa_id || 'Asset details'}</h2>
          <button onClick={onClose} style={modalCloseStyle} type="button">
            Close
          </button>
        </div>
        {meta?.description && <p style={modalDescriptionStyle}>{meta.description}</p>}
        <div style={modalGridStyle}>
          <div>
            {item.links?.[0]?.href ? (
              <img src={item.links[0].href} alt={meta?.title || 'preview'} style={modalPreviewStyle} />
            ) : (
              <div style={{ ...placeholderStyle, height: 280 }} aria-hidden="true" />
            )}
          </div>
          <div style={modalDetailsStyle}>
            <div style={{ marginBottom: 12 }}>
              {formatDate(meta?.date_created) && (
                <div>
                  <strong>Date:</strong> {formatDate(meta?.date_created)}
                </div>
              )}
              {meta?.center && (
                <div>
                  <strong>Center:</strong> {meta.center}
                </div>
              )}
              {meta?.photographer && (
                <div>
                  <strong>Photographer:</strong> {meta.photographer}
                </div>
              )}
              {meta?.secondary_creator && (
                <div>
                  <strong>Credits:</strong> {meta.secondary_creator}
                </div>
              )}
              {meta?.keywords?.length ? (
                <div>
                  <strong>Keywords:</strong> {meta.keywords.join(', ')}
                </div>
              ) : null}
            </div>
            <div>
              <strong>Files</strong>
              {error && (
                <div style={modalErrorStyle} role="alert">
                  {error}
                </div>
              )}
              {!error && !assets && <div style={modalLoadingStyle}>Loading files…</div>}
              {assets && (
                <ul style={modalListStyle}>
                  {assets.map(asset => {
                    const name = asset.href.split('/').pop() || asset.href;
                    return (
                      <li key={asset.href}>
                        <a href={asset.href} target="_blank" rel="noreferrer" style={modalLinkStyle}>
                          {name}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  padding: '16px',
  color: '#e5e7eb',
  background: 'linear-gradient(180deg, rgba(6, 11, 25, 0.92) 0%, rgba(8, 18, 36, 0.96) 100%)',
  minHeight: '100%',
  display: 'grid',
  gap: '16px',
};

const titleStyle: CSSProperties = {
  fontSize: '20px',
  margin: '4px 0 0',
};

const formStyle: CSSProperties = {
  display: 'grid',
  gap: '8px',
  gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto',
  alignItems: 'center',
  width: '100%',
};

const inputStyle: CSSProperties = {
  padding: '8px',
  borderRadius: '6px',
  border: '1px solid #374151',
  background: '#111827',
  color: '#e5e7eb',
};

const buttonStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid #2563eb',
  background: '#1d4ed8',
  color: '#ffffff',
  fontWeight: 600,
  cursor: 'pointer',
};

const errorStyle: CSSProperties = {
  marginTop: 12,
  padding: 10,
  background: 'rgba(220,38,38,0.15)',
  border: '1px solid #ef4444',
  borderRadius: 6,
};

const hintStyle: CSSProperties = {
  marginTop: 8,
  color: '#9ca3af',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '12px',
};

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  textAlign: 'left',
  background: 'rgba(15, 23, 42, 0.65)',
  border: '1px solid #1f2937',
  borderRadius: 8,
  padding: 8,
  cursor: 'pointer',
  color: '#d1d5db',
};

const thumbnailStyle: CSSProperties = {
  width: '100%',
  display: 'block',
  borderRadius: 6,
};

const placeholderStyle: CSSProperties = {
  height: 140,
  background: '#111827',
  borderRadius: 6,
};

const cardBodyStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  lineHeight: 1.25,
};

const cardTitleStyle: CSSProperties = {
  fontWeight: 600,
  marginBottom: 4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const cardMetaStyle: CSSProperties = {
  fontSize: 12,
  color: '#9ca3af',
};

const loadingStyle: CSSProperties = {
  margin: '16px 0',
  color: '#9ca3af',
};

const modalOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'grid',
  placeItems: 'center',
  zIndex: 1000,
  padding: '16px',
};

const modalStyle: CSSProperties = {
  width: 'min(920px, 95vw)',
  maxHeight: '90vh',
  overflow: 'auto',
  background: '#0b1220',
  border: '1px solid #1f2937',
  borderRadius: 10,
  padding: 16,
  color: '#e5e7eb',
  display: 'grid',
  gap: 12,
};

const modalHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
};

const modalTitleStyle: CSSProperties = {
  fontSize: 18,
  margin: 0,
};

const modalCloseStyle: CSSProperties = {
  border: '1px solid #374151',
  background: '#111827',
  color: '#d1d5db',
  borderRadius: 6,
  padding: '6px 10px',
  cursor: 'pointer',
};

const modalDescriptionStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  color: '#cbd5e1',
  margin: 0,
};

const modalGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: 16,
};

const modalPreviewStyle: CSSProperties = {
  width: '100%',
  borderRadius: 8,
};

const modalDetailsStyle: CSSProperties = {
  fontSize: 14,
  display: 'grid',
  gap: 12,
};

const modalErrorStyle: CSSProperties = {
  color: '#ef4444',
  marginTop: 6,
};

const modalLoadingStyle: CSSProperties = {
  color: '#9ca3af',
  marginTop: 6,
};

const modalListStyle: CSSProperties = {
  marginTop: 6,
  paddingLeft: 18,
};

const modalLinkStyle: CSSProperties = {
  color: '#60a5fa',
};
