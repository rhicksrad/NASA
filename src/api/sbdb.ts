const DEG2RAD = Math.PI / 180;

export type ConicForProp = {
  q: number;
  e: number;
  i: number;
  Omega: number;
  omega: number;
  tp: number;
  a: number;
};

type SBDBResponse = {
  object?: { fullname?: string };
  orbit?: { elements?: Array<{ name: string; value: string | number }> };
};

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : Number.NaN;
  }
  return Number.NaN;
}

export async function loadSBDBConic(
  sstr: string,
): Promise<{ conic: ConicForProp; label: string }> {
  const base = import.meta.env?.VITE_API_BASE ?? '';
  const origin = base || (typeof window !== 'undefined' ? window.location.origin : '');
  if (!origin) {
    throw new Error('SBDB base URL unavailable');
  }
  const url = new URL('/sbdb', origin);
  url.searchParams.set('sstr', sstr);
  url.searchParams.set('fullname', 'true');

  const r = await fetch(url.toString());
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`SBDB ${r.status}: ${text || url.toString()}`);
  }
  const data = (await r.json()) as SBDBResponse;
  const elems = data.orbit?.elements ?? [];
  const map = new Map<string, unknown>(elems.map((e) => [e.name, e.value]));

  const e = toNum(map.get('e'));
  const q = toNum(map.get('q'));
  const i = toNum(map.get('i')) * DEG2RAD;
  const Om = toNum(map.get('om')) * DEG2RAD;
  const w = toNum(map.get('w')) * DEG2RAD;
  const tp = toNum(map.get('tp'));
  let a = toNum(map.get('a'));

  if (!Number.isFinite(a) && Number.isFinite(q) && Number.isFinite(e)) {
    a = q / (1 - e);
  }

  if (![e, q, i, Om, w, tp, a].every(Number.isFinite)) {
    throw new Error('SBDB elements incomplete/invalid');
  }

  return {
    conic: { e, q, i, Omega: Om, omega: w, tp, a },
    label: data.object?.fullname || sstr,
  };
}
