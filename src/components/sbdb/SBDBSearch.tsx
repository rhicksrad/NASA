import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { icon } from '../../utils/icons';
import {
  ADVANCED_FIELDS,
  DEFAULT_FIELDS,
  SBDB_WORKER,
  type FieldName,
  type SbdbFieldValue,
  type SbdbSearchResponse,
  type SbdbSearchResult,
  type SbdbTypeFilter,
  fetchSbdbSearch,
} from '../../utils/sbdb';
import { DetailsPanel } from './DetailsPanel';
import { ResultRow } from './ResultRow';
import {
  type SbdbIndexEntry,
  type SbdbIndexPayload,
  loadSbdbIndex,
  searchSbdbIndex,
} from '../../data/sbdbIndex';

const ROW_HEIGHT = 92;
const OVERSCAN = 6;

const LIMIT_OPTIONS = [50, 100, 200] as const;
const TYPE_OPTIONS: Array<{ value: SbdbTypeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'ast', label: 'Asteroids' },
  { value: 'com', label: 'Comets' },
];

interface ParsedState {
  q: string;
  limit: number;
  types: SbdbTypeFilter;
  advanced: FieldName[];
}

interface HttpStatusError extends Error {
  status?: number;
  bodyText?: string;
}

interface SearchError {
  message: string;
  status?: number;
}

const DEFAULT_LIMIT = 200;

function parseStateFromSearch(): ParsedState {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q') ?? '';
  const limit = Number(params.get('limit') ?? DEFAULT_LIMIT);
  const limitValue = LIMIT_OPTIONS.includes(limit as (typeof LIMIT_OPTIONS)[number]) ? limit : DEFAULT_LIMIT;
  const typesParam = params.get('types');
  const types = TYPE_OPTIONS.some((option) => option.value === typesParam) ? (typesParam as SbdbTypeFilter) : 'all';
  const fieldsParam = params.get('fields');
  const advanced: FieldName[] = [];
  if (fieldsParam) {
    const rawFields = fieldsParam.split(',');
    rawFields.forEach((field) => {
      if (ADVANCED_FIELDS.includes(field as FieldName)) {
        advanced.push(field as FieldName);
      }
    });
  }
  return { q, limit: limitValue, types, advanced };
}

function buildFields(base: readonly FieldName[], advanced: readonly FieldName[]): FieldName[] {
  const deduped: FieldName[] = [];
  const seen = new Set<FieldName>();
  [...base, ...advanced].forEach((field) => {
    if (!seen.has(field)) {
      seen.add(field);
      deduped.push(field);
    }
  });
  return deduped;
}

function identifierFromRow(row: Record<FieldName, SbdbFieldValue | undefined>): string | null {
  const full = row.full_name;
  if (typeof full === 'string' && full.trim()) return full;
  const pdes = row.pdes;
  if (typeof pdes === 'string' && pdes.trim()) return pdes;
  if (typeof pdes === 'number') return String(pdes);
  const des = row.des;
  if (typeof des === 'string' && des.trim()) return des;
  if (typeof des === 'number') return String(des);
  return null;
}

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

export function SBDBSearch(): JSX.Element {
  const parsed = useMemo(parseStateFromSearch, []);
  const [query, setQuery] = useState(parsed.q);
  const [limit, setLimit] = useState<number>(parsed.limit);
  const [types, setTypes] = useState<SbdbTypeFilter>(parsed.types);
  const [advancedFields, setAdvancedFields] = useState<FieldName[]>(parsed.advanced);
  const [advancedOpen, setAdvancedOpen] = useState(parsed.advanced.length > 0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SbdbSearchResponse | null>(null);
  const [upstreamQuery, setUpstreamQuery] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<SearchError | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [detailIdentifier, setDetailIdentifier] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);
  const [indexPayload, setIndexPayload] = useState<SbdbIndexPayload | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);

  const requestedFields = useMemo(
    () => buildFields(DEFAULT_FIELDS, advancedFields),
    [advancedFields],
  );

  const trimmedQuery = query.trim();

  function mapIndexEntryToRow(entry: SbdbIndexEntry): Record<FieldName, SbdbFieldValue | undefined> {
    if (entry.type === 'ast') {
      const number = entry.number ?? '';
      const baseName = entry.name ?? '';
      const full = number && baseName ? `${number} ${baseName}` : baseName || number;
      const designation = entry.principal ?? entry.other[0] ?? null;
      return {
        full_name: full || designation || null,
        pdes: number || designation || null,
        des: designation,
        neo: entry.neo ? 'Y' : undefined,
        kind: 'A',
        H: entry.h ?? null,
        epoch_tdb: entry.epoch ?? null,
      };
    }
    const designation = entry.designation;
    const base = designation.includes('(') ? designation.split('(')[0]!.trim() : designation;
    return {
      full_name: designation,
      pdes: base || entry.packed || null,
      des: entry.packed ?? null,
      kind: 'C',
      H: entry.h ?? null,
      epoch_tdb: null,
    };
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (trimmedQuery) {
      params.set('q', trimmedQuery);
    } else {
      params.delete('q');
    }
    params.set('limit', String(limit));
    params.set('types', types);
    params.set('fields', requestedFields.join(','));
    const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, '', next);
    }
  }, [trimmedQuery, limit, types, requestedFields]);

  useEffect(() => {
    const onPopState = () => {
      const latest = parseStateFromSearch();
      setQuery(latest.q);
      setLimit(latest.limit);
      setTypes(latest.types);
      setAdvancedFields(latest.advanced);
      setAdvancedOpen(latest.advanced.length > 0);
      setRefreshToken((token) => token + 1);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSbdbIndex()
      .then((payload) => {
        if (cancelled) return;
        setIndexPayload(payload);
        setIndexError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setIndexError(message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          setViewportHeight(entry.contentRect.height);
        }
      }
    });
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const handleScroll = () => {
      setScrollTop(container.scrollTop);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!trimmedQuery) {
      setResult(null);
      setSearchError(null);
      setUpstreamQuery(null);
      setLoading(false);
      setSelectedIndex(null);
      return;
    }

    const wantsLocalIndex = advancedFields.length === 0;
    if (wantsLocalIndex && !indexPayload && !indexError) {
      setLoading(true);
      setSearchError(null);
      setResult(null);
      setSelectedIndex(null);
      return;
    }

    if (wantsLocalIndex && indexPayload) {
      const { items, total } = searchSbdbIndex(indexPayload, { query: trimmedQuery, limit, types });
      const rows = items.map((entry) => mapIndexEntryToRow(entry));
      setResult({ fields: DEFAULT_FIELDS.slice() as FieldName[], count: total, data: rows });
      setUpstreamQuery(null);
      setSearchError(null);
      setLoading(false);
      setSelectedIndex(rows.length > 0 ? 0 : null);
      if (listRef.current) {
        listRef.current.scrollTop = 0;
      }
      setScrollTop(0);
      return;
    }

    const controller = new AbortController();
    const debounce = window.setTimeout(() => {
      setLoading(true);
      setSearchError(null);
      fetchSbdbSearch(controller.signal, {
        q: trimmedQuery,
        limit,
        types,
        fields: requestedFields,
      })
        .then((payload: SbdbSearchResult) => {
          if (controller.signal.aborted) return;
          setResult(payload.response);
          setUpstreamQuery(payload.upstreamQuery ?? null);
          setSearchError(null);
          setSelectedIndex(payload.response.data.length > 0 ? 0 : null);
          if (listRef.current) {
            listRef.current.scrollTop = 0;
          }
          setScrollTop(0);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
          const typed = err as HttpStatusError;
          setSearchError({
            message: typed?.message ?? 'SBDB search failed',
            status: typeof typed?.status === 'number' ? typed.status : undefined,
          });
          setResult(null);
          setSelectedIndex(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, 300);
    return () => {
      window.clearTimeout(debounce);
      controller.abort();
    };
  }, [
    trimmedQuery,
    limit,
    types,
    requestedFields,
    refreshToken,
    advancedFields,
    indexPayload,
    indexError,
  ]);

  useEffect(() => {
    if (selectedIndex === null) return;
    const container = listRef.current;
    if (!container) return;
    const top = selectedIndex * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    const currentTop = container.scrollTop;
    const currentBottom = currentTop + container.clientHeight;
    if (top < currentTop) {
      container.scrollTop = top;
    } else if (bottom > currentBottom) {
      container.scrollTop = bottom - container.clientHeight;
    }
  }, [selectedIndex]);

  const rows = result?.data ?? [];
  const count = result?.count ?? 0;
  const totalHeight = rows.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(rows.length, startIndex + visibleCount);
  const visibleRows = rows.slice(startIndex, endIndex);
  const usingLocalIndex = advancedFields.length === 0 && indexPayload !== null;

  const activeRowId = selectedIndex !== null ? `sbdb-row-${selectedIndex}` : undefined;

  const openDetails = (identifier: string | null) => {
    if (!identifier) return;
    setDetailIdentifier(identifier);
    setDetailOpen(true);
  };

  const handleRowActivate = (rowIndex: number) => {
    const row = rows[rowIndex];
    if (!row) return;
    const identifier = identifierFromRow(row);
    openDetails(identifier);
  };

  const handleRetry = () => {
    setRefreshToken((token) => token + 1);
  };

  const diagLink = `${SBDB_WORKER}/sbdb/search?q=1&limit=50`;

  return (
    <div className="sbdb-search">
      <div className="sbdb-search__controls">
        <label className="sbdb-search__label" htmlFor="sbdb-search-input">
          <span dangerouslySetInnerHTML={{ __html: icon('search', { label: 'Search SBDB' }) }} />
          <span>Search SBDB</span>
        </label>
        <div className={`sbdb-search__input${loading ? ' is-loading' : ''}`}>
          <input
            id="sbdb-search-input"
            type="search"
            placeholder="Type a prefix (e.g. 1, 101955, 1P)"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search SBDB by prefix"
          />
          {loading ? <span className="sbdb-search__spinner" aria-hidden="true" /> : null}
        </div>
        <div className="sbdb-search__filters">
          <label>
            Limit
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              {LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Types
            <select value={types} onChange={(event) => setTypes(event.target.value as SbdbTypeFilter)}>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="sbdb-search__advanced-toggle"
            onClick={() => {
              setAdvancedOpen((open) => {
                const next = !open;
                if (!next) {
                  setAdvancedFields([]);
                }
                return next;
              });
            }}
            aria-expanded={advancedOpen}
          >
            Advanced fields
          </button>
        </div>
        {advancedOpen ? (
          <fieldset className="sbdb-search__advanced">
            <legend>Additional fields</legend>
            {ADVANCED_FIELDS.map((field) => {
              const labelMap: Record<FieldName, string> = {
                diameter_km: 'Diameter (km)',
                albedo: 'Albedo',
                G: 'Slope parameter (G)',
                rot_per: 'Rotation period',
                class: 'Class',
                full_name: 'Full name',
                pdes: 'Permanent designation',
                des: 'Designation',
                neo: 'NEO',
                kind: 'Kind',
                H: 'H',
                epoch_tdb: 'Epoch TDB',
              };
              return (
                <label key={field}>
                  <input
                    type="checkbox"
                    checked={advancedFields.includes(field)}
                    onChange={(event) => {
                      setAdvancedFields((current) => {
                        if (event.target.checked) {
                          if (current.includes(field)) return current;
                          return [...current, field];
                        }
                        return current.filter((item) => item !== field);
                      });
                    }}
                  />
                  {labelMap[field]}
                </label>
              );
            })}
          </fieldset>
        ) : null}
        <div className="sbdb-search__status">
          {trimmedQuery ? (
            <span>
              Showing {formatCount(rows.length)} of {formatCount(count)} matches
              {usingLocalIndex ? ' · Local index' : ''}
            </span>
          ) : (
            <span>Enter a prefix to search SBDB</span>
          )}
          <a href={diagLink} target="_blank" rel="noopener">
            diag
          </a>
        </div>
      </div>
      {searchError ? (
        <div className="sbdb-search__error" role="alert">
          <span>
            {searchError.status ? `HTTP ${searchError.status}: ` : ''}
            {searchError.message}
          </span>
          <button type="button" onClick={handleRetry}>
            Retry
          </button>
        </div>
      ) : null}
      <div
        ref={listRef}
        className="sbdb-search__results"
        role="listbox"
        tabIndex={0}
        aria-label="SBDB search results"
        aria-activedescendant={activeRowId}
        aria-busy={loading}
        onKeyDown={(event) => {
          if (!rows.length) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelectedIndex((current) => {
              const next = current === null ? 0 : Math.min(rows.length - 1, current + 1);
              return next;
            });
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelectedIndex((current) => {
              const next = current === null ? rows.length - 1 : Math.max(0, current - 1);
              return next;
            });
          } else if (event.key === 'Home') {
            event.preventDefault();
            setSelectedIndex(rows.length ? 0 : null);
          } else if (event.key === 'End') {
            event.preventDefault();
            setSelectedIndex(rows.length ? rows.length - 1 : null);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (selectedIndex !== null) {
              handleRowActivate(selectedIndex);
            }
          }
        }}
      >
        {loading && !rows.length ? (
          <div className="sbdb-search__skeleton" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="sbdb-search__skeleton-row" />
            ))}
          </div>
        ) : null}
        {!loading && !rows.length && trimmedQuery ? (
          <div className="sbdb-search__empty">No matches for “{trimmedQuery}”.</div>
        ) : null}
        <div className="sbdb-search__spacer" style={{ height: totalHeight }}>
          <div className="sbdb-search__items" style={{ transform: `translateY(${startIndex * ROW_HEIGHT}px)` }}>
            {visibleRows.map((row, offset) => {
              const index = startIndex + offset;
              return (
                <ResultRow
                  key={index}
                  id={`sbdb-row-${index}`}
                  row={row}
                  fields={requestedFields}
                  prefix={trimmedQuery}
                  isSelected={selectedIndex === index}
                  onSelect={() => setSelectedIndex(index)}
                  onActivate={() => handleRowActivate(index)}
                />
              );
            })}
          </div>
        </div>
      </div>
      <footer className="sbdb-search__footer">
        <span>Worker upstream: {upstreamQuery ?? 'n/a'}</span>
      </footer>
      {createPortal(
        <DetailsPanel
          open={detailOpen}
          identifier={detailIdentifier}
          onClose={() => setDetailOpen(false)}
          onAddToScene={(identifier) => {
            window.dispatchEvent(new CustomEvent('neo3d:add-sbdb', { detail: identifier }));
            setDetailOpen(false);
          }}
        />,
        document.body,
      )}
    </div>
  );
}
