const DEFAULT_WORKER_BASE = 'https://lively-haze-4b2c.hicksrch.workers.dev';

function normalizeBase(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '';

  const withoutTrailing = trimmed.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(withoutTrailing)) {
    return withoutTrailing;
  }

  const withLeading = withoutTrailing.startsWith('/') ? withoutTrailing : `/${withoutTrailing}`;
  return withLeading;
}

const envBase = normalizeBase(import.meta.env.VITE_API_BASE);
const base = envBase || DEFAULT_WORKER_BASE;

if (!envBase && typeof console !== 'undefined') {
  // eslint-disable-next-line no-console
  console.info(`[api/base] Falling back to default worker ${DEFAULT_WORKER_BASE}`);
}

export const BASE = base;
export const ATLAS_SBDB_PATH = '/sbdb?sstr=3I&fullname=true';
export const DEFAULT_ATLAS_WORKER_URL = `${DEFAULT_WORKER_BASE}${ATLAS_SBDB_PATH}`;
