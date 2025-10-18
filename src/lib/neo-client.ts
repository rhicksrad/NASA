const WORKER = "https://lively-haze-4b2c.hicksrch.workers.dev";

export type NeoLite = {
  id: string;
  name: string;
  absMag?: number;
  estDiamKm?: number | null;
  spkId?: string;
};

export type NextApproach = {
  jd: string;
  date: string;   // "YYYY-Mon-DD HH:MM"
  distAu: string; // AU
  vRelKms: string;// km/s
};

type NeoWsPage = {
  page: { size: number; total_elements: number; total_pages: number; number: number };
  near_earth_objects: any[];
};

type SbdbResp = { count: number; fields: string[]; data: (string | number | null)[][]; more?: boolean };
type CadResp = { count: number; fields: string[]; data: string[][] };

export async function fetchNeosViaWorker(opts?: {
  pageSize?: number;      // 1..250, default 200
  maxPages?: number;      // guardrail
  limit?: number;         // max objects
  enrichNext?: boolean;   // default true
  throttleMs?: number;    // default 75
  signal?: AbortSignal;
}): Promise<(NeoLite & { next?: NextApproach | null })[]> {
  const pageSize = clampInt(opts?.pageSize ?? 200, 1, 250);
  const maxPages = opts?.maxPages ?? Number.POSITIVE_INFINITY;
  const limit    = opts?.limit ?? Number.POSITIVE_INFINITY;
  const enrich   = opts?.enrichNext ?? true;
  const throttle = opts?.throttleMs ?? 75;
  const signal   = opts?.signal;

  const out: NeoLite[] = [];
  let page = 0, totalPages = 1;

  while (page < totalPages && page < maxPages && out.length < limit) {
    const { objects, pageNum, pages } = await neowsPage(page, pageSize, signal);
    totalPages = pages;
    page = pageNum + 1;
    for (const o of objects) {
      out.push(mapNeoWs(o));
      if (out.length >= limit) break;
    }
  }

  if (!enrich) return out;

  const enriched: (NeoLite & { next?: NextApproach | null })[] = [];
  for (let i = 0; i < out.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const n = out[i];
    const next = await cadNext(n, signal).catch(() => null);
    enriched.push({ ...n, next });
    if (throttle > 0) await sleep(throttle);
  }
  return enriched;
}

export async function fetchSbdbNeosViaWorker(opts?: {
  batch?: number;        // 1..5000, default 1000
  limit?: number;
  enrichNext?: boolean;  // default true
  throttleMs?: number;   // default 75
  signal?: AbortSignal;
}): Promise<(NeoLite & { next?: NextApproach | null })[]> {
  const batch    = clampInt(opts?.batch ?? 1000, 1, 5000);
  const limit    = opts?.limit ?? Number.POSITIVE_INFINITY;
  const enrich   = opts?.enrichNext ?? true;
  const throttle = opts?.throttleMs ?? 75;
  const signal   = opts?.signal;

  const out: NeoLite[] = [];
  for (let offset = 0; out.length < limit; offset += batch) {
    const rows = await sbdbChunk(offset, batch, signal);
    if (!rows.length) break;
    for (const row of rows) {
      out.push(mapSbdb(row));
      if (out.length >= limit) break;
    }
    if (rows.length < batch) break;
  }

  if (!enrich) return out;

  const enriched: (NeoLite & { next?: NextApproach | null })[] = [];
  for (let i = 0; i < out.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const n = out[i];
    const next = await cadNext(n, signal).catch(() => null);
    enriched.push({ ...n, next });
    if (throttle > 0) await sleep(throttle);
  }
  return enriched;
}

// Worker-backed requests
async function neowsPage(page: number, size: number, signal?: AbortSignal) {
  const u = new URL(WORKER + "/neows/browse");
  u.searchParams.set("page", String(page));
  u.searchParams.set("size", String(size));
  const r = await fetch(u, { signal });
  if (!r.ok) throw new Error(`NeoWs ${r.status}`);
  const j = (await r.json()) as NeoWsPage;
  return { objects: j.near_earth_objects, pageNum: j.page.number, pages: j.page.total_pages };
}

async function sbdbChunk(offset: number, limit: number, signal?: AbortSignal) {
  const u = new URL(WORKER + "/sbdb_query.api");
  u.searchParams.set("neo", "Y");
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));
  u.searchParams.set("fields", "des,full_name,H,diameter,spkId");
  const r = await fetch(u, { signal });
  if (!r.ok) throw new Error(`SBDB ${r.status}`);
  const j = (await r.json()) as SbdbResp;
  return j.data.map(row => Object.fromEntries(j.fields.map((k, i) => [k, row[i]])));
}

async function cadNext(n: NeoLite, signal?: AbortSignal): Promise<NextApproach | null> {
  const u = new URL(WORKER + "/cad.api");
  if (n.spkId) u.searchParams.set("spk", n.spkId);
  else u.searchParams.set("des", n.id || n.name);
  u.searchParams.set("date-min", "NOW");
  u.searchParams.set("date-max", "2100-01-01");
  u.searchParams.set("limit", "1");
  u.searchParams.set("sort", "date");
  const r = await fetch(u, { signal });
  if (!r.ok) return null;
  const j = (await r.json()) as CadResp;
  if (!j.count || !j.data?.length) return null;
  const [jd, cd, dist, vrel] = pick(j, ["jd", "cd", "dist", "v_rel"]);
  return { jd, date: cd, distAu: dist, vRelKms: vrel };
}

// mappers
function mapNeoWs(o: any): NeoLite {
  const est = o.estimated_diameter?.kilometers;
  const estAvg = typeof est?.estimated_diameter_min === "number" && typeof est?.estimated_diameter_max === "number"
    ? (est.estimated_diameter_min + est.estimated_diameter_max) / 2
    : null;
  return {
    id: String(o.id ?? o.neo_reference_id ?? o.name ?? o.designation),
    name: String(o.name ?? o.designation ?? o.id),
    absMag: asNum(o.absolute_magnitude_h),
    estDiamKm: estAvg,
    spkId: o.nasa_jpl_url?.match(/spk=(\d+)/)?.[1],
  };
}

function mapSbdb(row: any): NeoLite {
  return {
    id: String(row.des ?? row.full_name ?? row.spkId ?? ""),
    name: String(row.full_name ?? row.des ?? ""),
    absMag: asNum(row.H),
    estDiamKm: asNum(row.diameter) ?? null,
    spkId: row.spkId ? String(row.spkId) : undefined,
  };
}

// utils
function asNum(x: any): number | undefined {
  const n = typeof x === "string" ? Number(x) : x;
  return Number.isFinite(n) ? n : undefined;
}

function pick(resp: { fields: string[]; data: string[][] }, names: string[]) {
  const idx = Object.fromEntries(resp.fields.map((k, i) => [k, i]));
  const row = resp.data[0] || [];
  return names.map(n => {
    const i = idx[n];
    return i == null ? "" : row[i];
  });
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
function clampInt(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}
