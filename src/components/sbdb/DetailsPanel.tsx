import { useEffect, useMemo, useRef, useState } from 'react';
import type { SbdbLookup } from '../../api/sbdb';
import { fetchSbdbDetail } from '../../utils/sbdb';
import { icon } from '../../utils/icons';

interface DetailsPanelProps {
  open: boolean;
  identifier: string | null;
  onClose: () => void;
  onAddToScene?: (identifier: string) => void;
}

interface DetailError {
  message: string;
  status?: number;
}

function findPhysValue(lookup: SbdbLookup, pattern: RegExp): string | number | null {
  const phys = lookup.phys_par ?? [];
  for (const entry of phys) {
    if (!entry?.name) continue;
    if (pattern.test(entry.name.toLowerCase())) {
      const value = entry.value;
      if (value === undefined || value === null) return null;
      return value;
    }
  }
  return null;
}

function findElementValue(lookup: SbdbLookup, names: string[]): string | number | null {
  const elements = lookup.orbit?.elements ?? [];
  for (const element of elements) {
    const key = (element.name || element.label || '').toLowerCase();
    if (names.some((candidate) => candidate.toLowerCase() === key)) {
      const value = element.value;
      if (value === undefined || value === null) return null;
      return value;
    }
  }
  return null;
}

function formatFactValue(value: string | number | null): string {
  if (value === null) return '—';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : '—';
  if (typeof value === 'string' && value.trim()) return value;
  return '—';
}

const focusableSelector = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function DetailsPanel({ open, identifier, onClose, onAddToScene }: DetailsPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SbdbLookup | string | null>(null);
  const [error, setError] = useState<DetailError | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !identifier) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    fetchSbdbDetail(controller.signal, identifier)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (err instanceof Error) {
          const status = (err as { status?: number }).status;
          setError({ message: err.message, status: typeof status === 'number' ? status : undefined });
        } else {
          setError({ message: 'SBDB lookup failed' });
        }
        setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [open, identifier]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      return;
    }
    const node = panelRef.current;
    if (!node) return;
    const focusable = Array.from(node.querySelectorAll<HTMLElement>(focusableSelector)).filter((el) => !el.hasAttribute('disabled'));
    const first = focusable[0] ?? null;
    if (first) {
      first.focus();
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab') {
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const active = document.activeElement as HTMLElement | null;
        const currentIndex = active ? focusable.indexOf(active) : -1;
        let nextIndex = currentIndex;
        if (event.shiftKey) {
          nextIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
        } else {
          nextIndex = currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
        }
        event.preventDefault();
        focusable[nextIndex]?.focus();
      }
    };
    node.addEventListener('keydown', handleKeydown);
    return () => {
      node.removeEventListener('keydown', handleKeydown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const handleFocus = (event: FocusEvent) => {
      if (!panelRef.current) return;
      if (panelRef.current.contains(event.target as Node)) return;
      const first = panelRef.current.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    };
    document.addEventListener('focus', handleFocus, true);
    return () => {
      document.removeEventListener('focus', handleFocus, true);
    };
  }, [open]);

  const lookup = useMemo(() => {
    if (!data || typeof data === 'string') return null;
    return data;
  }, [data]);

  const facts = useMemo(() => {
    if (!lookup) return [] as Array<{ label: string; value: string }>;
    const items: Array<{ label: string; value: string }> = [];
    const orbitClass = lookup.object?.orbit_class?.name || lookup.object?.orbit_class?.code || null;
    const magnitude = findPhysValue(lookup, /^(h)$/i);
    const albedo = findPhysValue(lookup, /albedo/);
    const diameter = findPhysValue(lookup, /diam/);
    const rotation = findPhysValue(lookup, /rot/);
    const epoch = lookup.orbit?.epoch ?? findElementValue(lookup, ['epoch']);
    if (orbitClass) items.push({ label: 'Orbit class', value: formatFactValue(orbitClass) });
    if (magnitude !== null) items.push({ label: 'Absolute magnitude (H)', value: formatFactValue(magnitude) });
    if (albedo !== null) items.push({ label: 'Albedo', value: formatFactValue(albedo) });
    if (diameter !== null) items.push({ label: 'Diameter', value: formatFactValue(diameter) });
    if (rotation !== null) items.push({ label: 'Rotation period', value: formatFactValue(rotation) });
    if (epoch !== null) items.push({ label: 'Epoch', value: formatFactValue(epoch) });
    return items;
  }, [lookup]);

  const title = useMemo(() => {
    if (!lookup) return identifier ?? '';
    return (
      lookup.object?.fullname || lookup.object?.des || lookup.object?.object_name || identifier || ''
    );
  }, [identifier, lookup]);

  const copyIdentifier = async () => {
    if (!identifier) return;
    try {
      await navigator.clipboard.writeText(identifier);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const addToScene = () => {
    if (identifier) {
      onAddToScene?.(identifier);
    }
  };

  const jplLink = identifier
    ? `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(identifier)}`
    : null;

  return (
    <div className={`sbdb-details${open ? ' is-open' : ''}`} role="presentation">
      <div className="sbdb-details__backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className="sbdb-details__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sbdb-details-title"
      >
        <div className="sbdb-details__header">
          <h2 id="sbdb-details-title">{title}</h2>
          <div className="sbdb-details__header-actions">
            <button type="button" onClick={onClose} className="sbdb-details__icon-btn">
              <span dangerouslySetInnerHTML={{ __html: icon('close', { label: 'Close details' }) }} />
            </button>
          </div>
        </div>
        {identifier ? (
          <div className="sbdb-details__identifier">
            <code>{identifier}</code>
            <div className="sbdb-details__identifier-actions">
              <button type="button" onClick={copyIdentifier} className="sbdb-details__pill-btn">
                {copied ? 'Copied' : 'Copy ID'}
              </button>
              <button type="button" onClick={addToScene} className="sbdb-details__pill-btn">
                Add to 3D view
              </button>
              {jplLink ? (
                <a href={jplLink} target="_blank" rel="noopener" className="sbdb-details__pill-btn">
                  JPL SBDB
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="sbdb-details__body">
          {loading && <div className="sbdb-details__status">Loading details…</div>}
          {error ? (
            <div className="sbdb-details__status sbdb-details__status--error">
              {error.status ? `HTTP ${error.status}: ` : ''}
              {error.message}
            </div>
          ) : null}
          {!loading && !error && lookup && facts.length > 0 ? (
            <dl className="sbdb-details__facts">
              {facts.map((fact) => (
                <div key={fact.label} className="sbdb-details__fact">
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {!loading && !error && data ? (
            <details className="sbdb-details__raw" open>
              <summary>Raw SBDB payload</summary>
              <pre>{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
