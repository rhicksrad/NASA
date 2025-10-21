import type { FieldName, SbdbFieldValue } from '../../utils/sbdb';

const PREFIX_CLASS = 'sbdb-row__highlight';

function highlightPrefix(value: string, prefix: string): JSX.Element {
  if (!prefix) {
    return <>{value}</>;
  }
  const lowerValue = value.toLowerCase();
  const lowerPrefix = prefix.toLowerCase();
  if (!lowerValue.startsWith(lowerPrefix)) {
    return <>{value}</>;
  }
  const start = value.slice(0, prefix.length);
  const rest = value.slice(prefix.length);
  return (
    <>
      <span className={PREFIX_CLASS}>{start}</span>
      {rest}
    </>
  );
}

function formatNumber(value: SbdbFieldValue, fractionDigits = 2): string | null {
  if (typeof value === 'number') {
    return value.toFixed(fractionDigits);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed.toFixed(fractionDigits);
    }
    return value;
  }
  return null;
}

function describeKind(kind: SbdbFieldValue): string | null {
  if (kind === 'a' || kind === 'A') return 'AST';
  if (kind === 'c' || kind === 'C') return 'COM';
  if (typeof kind === 'string' && kind.trim()) {
    return kind.toUpperCase();
  }
  return null;
}

export interface ResultRowProps {
  id: string;
  row: Record<FieldName, SbdbFieldValue | undefined>;
  fields: FieldName[];
  prefix: string;
  isSelected: boolean;
  onSelect: () => void;
  onActivate: () => void;
}

function identifier(row: Record<FieldName, SbdbFieldValue | undefined>, key: FieldName): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return String(value);
}

function renderSecondary(
  row: Record<FieldName, SbdbFieldValue | undefined>,
  primaryKey: FieldName,
  prefix: string,
): JSX.Element | null {
  const parts: JSX.Element[] = [];
  const keys: FieldName[] = ['full_name', 'pdes', 'des'];
  keys.forEach((key) => {
    if (key === primaryKey) return;
    const value = identifier(row, key);
    if (!value) return;
    parts.push(
      <span key={key} className="sbdb-row__secondary-item">
        {highlightPrefix(value, prefix)}
      </span>,
    );
  });
  if (!parts.length) {
    return null;
  }
  return <div className="sbdb-row__secondary">{parts}</div>;
}

function renderAdvanced(
  row: Record<FieldName, SbdbFieldValue | undefined>,
  fields: FieldName[],
): JSX.Element | null {
  const keys = ['diameter_km', 'albedo', 'G', 'rot_per', 'class'] as FieldName[];
  const entries = keys
    .filter((key) => fields.includes(key))
    .map((key) => {
      const raw = row[key];
      if (raw === null || raw === undefined || raw === '') {
        return null;
      }
      let label: string;
      switch (key) {
        case 'diameter_km':
          label = 'Diameter (km)';
          break;
        case 'albedo':
          label = 'Albedo';
          break;
        case 'G':
          label = 'G';
          break;
        case 'rot_per':
          label = 'Rotation (h)';
          break;
        case 'class':
          label = 'Class';
          break;
        default:
          label = key;
      }
      let value: string;
      if (typeof raw === 'number') {
        value = raw.toString();
      } else if (typeof raw === 'boolean') {
        value = raw ? 'Yes' : 'No';
      } else {
        value = String(raw);
      }
      return (
        <li key={key}>
          <span className="sbdb-row__adv-label">{label}</span>
          <span className="sbdb-row__adv-value">{value}</span>
        </li>
      );
    })
    .filter((entry): entry is JSX.Element => Boolean(entry));
  if (!entries.length) {
    return null;
  }
  return <ul className="sbdb-row__advanced">{entries}</ul>;
}

export function ResultRow({ id, row, fields, prefix, isSelected, onSelect, onActivate }: ResultRowProps) {
  const fullName = identifier(row, 'full_name');
  const pdes = identifier(row, 'pdes');
  const primaryKey = ((): FieldName => {
    if (fullName) return 'full_name';
    if (pdes) return 'pdes';
    return 'des';
  })();
  const primaryValue = identifier(row, primaryKey) ?? '';
  const H = formatNumber(row.H, 1);
  const epoch = row.epoch_tdb;
  const kind = describeKind(row.kind);
  const neo =
    row.neo === true ||
    row.neo === 'true' ||
    row.neo === 'Y' ||
    row.neo === 'y' ||
    row.neo === 1;
  const secondary = renderSecondary(row, primaryKey, prefix);
  const advanced = renderAdvanced(row, fields);

  return (
    <div
      id={id}
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
      className={`sbdb-row${isSelected ? ' is-selected' : ''}`}
      onClick={() => {
        onSelect();
        onActivate();
      }}
      onMouseEnter={onSelect}
    >
      <div className="sbdb-row__header">
        <div className="sbdb-row__title">{highlightPrefix(primaryValue, prefix)}</div>
        <div className="sbdb-row__badges">
          {neo ? <span className="sbdb-row__badge sbdb-row__badge--neo">NEO</span> : null}
          {kind ? <span className="sbdb-row__badge">{kind}</span> : null}
        </div>
      </div>
      {secondary}
      {(H || epoch) && (
        <div className="sbdb-row__meta">
          {H ? <span>H {H}</span> : null}
          {epoch ? <span>Epoch TDB {epoch}</span> : null}
        </div>
      )}
      {advanced}
    </div>
  );
}
