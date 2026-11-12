// worker.js — Classic (service-worker) Worker (single file)
// CANONICAL SOURCE: paste this entire file into the Cloudflare dashboard.
// The deployed worker at lively-haze-4b2c.hicksrch.workers.dev must match this file.
//
// NASA api.nasa.gov + JPL SSD (SBDB) + Horizons + DONKI (CME) + EONET + Exoplanet TAP + TLE + NASA Images
//
// Changes vs previous deployed version (2026-07-07):
//   + /storm/find, /storm/{activityID}.json, /storm/{activityID}.md  (DONKI CME — routes were missing; helpers existed)
//   + /eonet/* passthrough and /event/{id}.md                        (EONET — routes were missing; helpers existed)
//   * /neo/feed now maps to neo/rest/v1/feed (was neo/rest/v1/neo/feed → 404)
//   * TLE origin upgraded to https
//   - All Artemis routes/helpers removed (Artemis page deleted from the site; mission ended 2026-04-10)
//
// Requires secret binding NASA_API for api.nasa.gov.

const API_ORIGIN         = 'https://api.nasa.gov';
const IMAGES_ORIGIN      = 'https://images-api.nasa.gov';
const SBDB_OBJECT_ORIGIN = 'https://ssd-api.jpl.nasa.gov/sbdb.api';
const HORIZONS_ORIGIN    = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const EONET_ORIGIN       = 'https://eonet.gsfc.nasa.gov/api/v3';
const TLE_ORIGIN         = 'https://tle.ivanstanojevic.me/api';
const EXO_TAP_SYNC       = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';

// -------- SBDB index shards (publish these yourself) --------
// Example: put two-char buckets at https://example.com/sbdb-index/ab.json
// Each file: JSON array of {pdes,des,full_name,kind,neo,H,epoch_tdb}
const INDEX_BASE = 'https://YOUR_HOST/sbdb-index';

// Search tuning
const SEARCH_DEFAULT_LIMIT = 50;
const SEARCH_MAX_LIMIT     = 500;
const SEARCH_DEFAULT_PAGE  = 1;

// Score weights for local ranking
const W = Object.freeze({
  EXACT_DES:   1000,
  EXACT_PDES:   950,
  EXACT_NAME:   900,
  STARTS_DES:   500,
  STARTS_PDES:  480,
  STARTS_NAME:  450,
  CONTAINS_DES: 300,
  CONTAINS_PDES:280,
  CONTAINS_NAME:250,
  BOOST_NEO:     50,
  BOOST_KNOWN:   15,
});

// Optional nudge for iconic targets
const KNOWN_NAMES = new Set([
  '1 Ceres', '2 Pallas', '3 Juno', '4 Vesta',
  '433 Eros', '101955 Bennu', '99942 Apophis', '3200 Phaethon',
  '67P/Churyumov-Gerasimenko', '1P/Halley'
]);

// Upstream timeouts/retries
const UPSTREAM_RETRIES      = 1;
const DEFAULT_TIMEOUT_MS    = 8000;
const SBDB_GET_TIMEOUT_MS   = 6000;

addEventListener('fetch', (event) => {
  event.respondWith(handle(event).catch(err =>
    json(500, { ok:false, message:'Unhandled error', error:String(err) }, '*')
  ));
});

/* ------------------------------- Headers/JSON ------------------------------ */
function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS, POST',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, *',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
function sec() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}
function json(status, body, origin, extra = {}) {
  return new Response(scrub(JSON.stringify(body)), {
    status,
    headers: { 'Content-Type':'application/json; charset=utf-8', ...sec(), ...cors(origin), ...extra },
  });
}
function markdown(status, text, origin, extra = {}) {
  return new Response(scrub(text), {
    status,
    headers: { 'Content-Type':'text/markdown; charset=utf-8', ...sec(), ...cors(origin), ...extra },
  });
}
function requireApi(origin) {
  if (!(typeof NASA_API !== 'undefined' && NASA_API)) {
    throw new Response(JSON.stringify({ ok:false, message:'NASA_API binding missing' }), {
      status: 500, headers: { 'Content-Type':'application/json; charset=utf-8', ...sec(), ...cors(origin) },
    });
  }
}
function safeWaitUntil(event, p) { try { if (event?.waitUntil) return event.waitUntil(p); } catch {} p.catch(()=>{}); }

/* ------------------------------ Secret hygiene ----------------------------- */
// Upstream URLs carry the NASA key as a query parameter. Nothing that leaves
// this Worker (diagnostic headers, error bodies) may include it.
function publicUrl(url) {
  const u = new URL(String(url));
  if (u.searchParams.has('api_key')) u.searchParams.set('api_key', 'REDACTED');
  return u.toString();
}
function scrub(text) {
  const key = (typeof NASA_API !== 'undefined' && NASA_API) ? String(NASA_API) : '';
  const out = String(text ?? '');
  return key ? out.split(key).join('REDACTED') : out;
}

/* --------------------------- Fetch with deadline --------------------------- */
function withTimeout(ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('timeout')), ms);
  return { signal: ac.signal, cancel: () => clearTimeout(t) };
}
async function xfer(upstreamUrl, origin, {
  cacheOK=false, diagHeader='', init=null, retries=UPSTREAM_RETRIES, retryBaseMs=180, timeoutMs=DEFAULT_TIMEOUT_MS
} = {}, event) {
  const url = typeof upstreamUrl === 'string' ? new URL(upstreamUrl) : upstreamUrl;
  const method = (init && init.method) ? String(init.method).toUpperCase() : 'GET';
  const cacheKey = new Request(url.toString(), { method:'GET' });
  const cache = caches.default;

  if (cacheOK && method === 'GET') {
    const hit = await cache.match(cacheKey);
    if (hit) {
      // Entries cached before the scrub below was added can still hold the key.
      const body = scrub(await hit.text().catch(()=> ''));
      const headers = { 'Content-Type': hit.headers.get('content-type') || 'application/octet-stream', ...sec(), ...cors(origin) };
      if (diagHeader) headers[diagHeader] = publicUrl(url);
      return new Response(body, { status: hit.status, headers });
    }
  }

  let attempt = 0;
  while (attempt <= retries) {
    const { signal, cancel } = withTimeout(timeoutMs);
    try {
      const headers = { Accept: 'application/json', ...(init?.headers || {}) };
      const r = await fetch(url.toString(), { cf:{ cacheTtl:0 }, ...(init||{}), headers, signal });
      cancel();
      const ct = r.headers.get('content-type') || 'application/octet-stream';
      // NeoWs echoes the request's api_key back inside its `links` URLs.
      const text = scrub(await r.text().catch(()=> ''));
      const outHeaders = { 'Content-Type': ct, ...sec(), ...cors(origin) };
      if (diagHeader) outHeaders[diagHeader] = publicUrl(url);

      if (!r.ok) {
        if ([429,500,502,503,504].includes(r.status) && attempt < retries) {
          const wait = retryBaseMs * Math.pow(2, attempt) + Math.floor(Math.random()*40);
          await new Promise(res => setTimeout(res, wait));
          attempt++; continue;
        }
        return new Response(JSON.stringify({ ok:false, status:r.status, url:publicUrl(url), body:text.slice(0, 2000) }), {
          status:r.status, headers:{ ...outHeaders, 'Cache-Control':'no-store' }
        });
      }

      const resp = new Response(text, { status:200, headers: outHeaders });
      if (cacheOK && method === 'GET') safeWaitUntil(event, cache.put(cacheKey, resp.clone()));
      return resp;
    } catch (e) {
      cancel();
      if (attempt < retries) {
        const wait = retryBaseMs * Math.pow(2, attempt) + Math.floor(Math.random()*40);
        await new Promise(res => setTimeout(res, wait));
        attempt++; continue;
      }
      return json(502, { ok:false, error:'Upstream fetch failed', detail:scrub(e), url:publicUrl(url) }, origin);
    }
  }
}

/* --------------------------------- Helpers -------------------------------- */
function toIntOr(def, v) { const s = String(v||'').trim(); return /^\d+$/.test(s) ? parseInt(s,10) : def; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function normalizeWhitespace(s) { return String(s||'').replace(/\s+/g, ' ').trim(); }
function isIsoDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s||'').trim()); }

/* ---------------------- Local ranker and query parsing --------------------- */
function scoreRow(qCore, mode, ops, row) {
  const q = qCore.toLowerCase();
  const des  = String(row.des||'').toLowerCase();
  const pdes = String(row.pdes||'').toLowerCase();
  const name = String(row.full_name||'').toLowerCase();

  let s = 0;
  const starts = (t) => t.startsWith(q);
  const contains = (t) => t.includes(q);

  if (des === q)  s += W.EXACT_DES;
  if (pdes === q) s += W.EXACT_PDES;
  if (name === q) s += W.EXACT_NAME;

  if (starts(des))  s += W.STARTS_DES;
  if (starts(pdes)) s += W.STARTS_PDES;
  if (starts(name)) s += W.STARTS_NAME;

  if (contains(des))  s += W.CONTAINS_DES;
  if (contains(pdes)) s += W.CONTAINS_PDES;
  if (contains(name)) s += W.CONTAINS_NAME;

  if (row.neo) s += W.BOOST_NEO;
  if (row.full_name && KNOWN_NAMES.has(String(row.full_name))) s += W.BOOST_KNOWN;

  s -= Math.min(20, Math.max(0, (String(row.des||'').length - 6)));
  return s;
}

/* --------------------------- Sharded index search -------------------------- */
function normKey(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function shardKey(q) {
  const k = normKey(q);
  return k.length >= 2 ? k.slice(0,2) : (k.length === 1 ? k + '_' : '__');
}
function shardUrls(q, mode='prefix') {
  const k = shardKey(q);
  const urls = [ `${INDEX_BASE}/${k}.json` ];
  if (mode === 'contains') {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
    const head = k[0], tail = k[1];
    const headIdx = alphabet.indexOf(head);
    const tailIdx = alphabet.indexOf(tail);
    const neighbors = [];
    if (headIdx > 0) neighbors.push(`${alphabet[headIdx-1]}${tail}`);
    if (headIdx >= 0 && headIdx < alphabet.length-1) neighbors.push(`${alphabet[headIdx+1]}${tail}`);
    if (tailIdx > 0) neighbors.push(`${head}${alphabet[tailIdx-1]}`);
    if (tailIdx >= 0 && tailIdx < alphabet.length-1) neighbors.push(`${head}${alphabet[tailIdx+1]}`);
    for (const nb of neighbors) urls.push(`${INDEX_BASE}/${nb}.json`);
  }
  return [...new Set(urls)];
}
async function fetchShard(url, origin, event) {
  const r = await xfer(url, origin, { cacheOK: true, init: { method: 'GET' }, timeoutMs: 8000, diagHeader: 'x-sbdb-shard' }, event);
  const text = await r.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return Array.isArray(parsed) ? parsed : [];
}
async function searchIndexFiles(qRaw, { mode='prefix', types='all', limit=50, page=1 }, origin, event) {
  const q = (qRaw||'').trim();
  const urls = shardUrls(q, mode);
  const shards = await Promise.all(urls.map(u => fetchShard(u, origin, event)));
  const rows = shards.flat();

  const wantAst = types === 'ast';
  const wantCom = types === 'com';
  const qn = q.toLowerCase();

  const filt = rows.filter(r => {
    if (wantAst && !(String(r.kind||'').startsWith('a'))) return false;
    if (wantCom && !(String(r.kind||'').startsWith('c'))) return false;

    const d  = String(r.des||'').toLowerCase();
    const pd = String(r.pdes||'').toLowerCase();
    const nm = String(r.full_name||'').toLowerCase();

    if (mode === 'prefix') return d.startsWith(qn) || pd.startsWith(qn) || nm.startsWith(qn);
    return d.includes(qn) || pd.includes(qn) || nm.includes(qn);
  });

  const scored = filt.map(r => ({ r, s: scoreRow(q, mode, {}, r) }));
  scored.sort((a,b) => b.s - a.s ||
    String(a.r.pdes||'').localeCompare(String(b.r.pdes||'')) ||
    String(a.r.des||'').localeCompare(String(b.r.des||'')) ||
    String(a.r.full_name||'').localeCompare(String(b.r.full_name||'')));

  const pageSize = Math.max(1, Math.min(limit, SEARCH_MAX_LIMIT));
  const offset = (Math.max(1, page) - 1) * pageSize;
  const items = scored.slice(offset, offset + pageSize).map(x => x.r);

  return { ok:true, total: scored.length, items, shardUrls: urls };
}

/* --------------------------- Suggest + Resolve ----------------------------- */
async function runObjectResolve(desOrName, origin, event, _depth=0) {
  const upstream = new URL(SBDB_OBJECT_ORIGIN);
  upstream.searchParams.set('sstr', desOrName);
  const resp = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } });
  const text = await resp.text();

  let body = null; try { body = JSON.parse(text); } catch {}

  if (resp.ok) {
    const obj = body?.object || (Array.isArray(body?.list) ? body.list[0] : null) || body;
    return { ok:true, object: obj };
  }

  if (resp.status === 300 && body && Array.isArray(body.list) && body.list.length) {
    const sstr = String(desOrName).trim().toLowerCase();
    let pick = body.list.find(x => String(x.pdes||'').toLowerCase() === sstr);
    if (!pick) pick = body.list.find(x => String(x.name||x.fullname||'').toLowerCase() === sstr);

    if (pick && _depth === 0) {
      const key = String(pick.pdes || pick.name || pick.fullname || sstr);
      return runObjectResolve(key, origin, event, _depth+1);
    }

    const candidates = body.list.map(x => ({
      pdes: x.pdes || null,
      name: x.name || x.fullname || null
    }));
    return {
      ok: true,
      match: 'ambiguous',
      candidates,
      message: body.message || 'Multiple matches'
    };
  }

  return {
    ok:false,
    status: resp.status,
    message: body?.message || 'SBDB upstream error',
    body: body || text.slice(0, 2000)
  };
}

async function runSuggest(q, origin, event) {
  const core = normalizeWhitespace(q);
  if (!core) return { ok:true, q:'', count:0, items:[] };

  const out = await searchIndexFiles(core, { mode:'prefix', limit:20, page:1 }, origin, event);
  const items = out.items.slice(0, 20).map(r => ({ full_name:r.full_name||null, des:r.des||null, pdes:r.pdes||null }));
  return { ok:true, q:core, count: items.length, items };
}

/* ------------------------------ Exoplanet TAP ------------------------------ */
function tapURL(adql, fmt = 'json') {
  const u = new URL(EXO_TAP_SYNC);
  u.searchParams.set('query', adql);
  u.searchParams.set('format', fmt);
  return u;
}

/* --------------------------------- DONKI ---------------------------------- */
async function fetchDONKI(service, params) {
  const url = new URL(`${API_ORIGIN}/DONKI/${service}`);
  url.searchParams.set('api_key', NASA_API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const { signal, cancel } = withTimeout(12000);
  try {
    const r = await fetch(url.toString(), { headers: { Accept: 'application/json' }, signal });
    const text = await r.text();
    cancel();
    if (!r.ok) throw new Error(`DONKI ${service} ${r.status}`);
    // DONKI returns an empty body (not []) when there is no data in range
    if (!text.trim()) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    cancel();
    throw e;
  }
}
const hasLinked = (it, id) => Array.isArray(it?.linkedEvents) && it.linkedEvents.some(e=>e.activityID===id);
const enlilUses = (it, id) => Array.isArray(it?.cmeInputs) && it.cmeInputs.some(e=>e.activityID===id);
function windowFromActivityId(activityId) {
  const m = activityId.match(/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}/);
  const base = m ? new Date(m[1] + 'T00:00:00Z') : new Date();
  const start = new Date(base); start.setUTCDate(start.getUTCDate() - 2);
  const end   = new Date(base); end.setUTCDate(end.getUTCDate() + 5);
  const iso = d => d.toISOString().slice(0,10);
  return { startDate: iso(start), endDate: iso(end) };
}
function toStormMarkdown(activityId, joined) {
  const { cme, analyses, enlil, ips, gst, notes, window } = joined;
  const fmt = (d) => d ? String(d).replace('T',' ').replace('Z',' UTC') : 'n/a';
  const lines = [];
  lines.push(`# CME Explorer: ${activityId}`);
  lines.push(`Window: ${window.startDate} -> ${window.endDate}`);
  if (cme) {
    const t0 = cme.startTime || cme.time || cme.startTimeUTC;
    lines.push(`CME time: ${fmt(t0)}`);
    if (cme.note) lines.push(`> ${cme.note}`);
  }
  lines.push('');
  const primary = analyses?.[0] || {};
  const speed = primary.speed ?? primary.cmeSpeed;
  const width = primary.halfAngle ? primary.halfAngle*2 : primary.angularWidth;
  lines.push('Summary');
  lines.push(`- speed: ${speed || 'n/a'} km/s`);
  lines.push(`- width: ${width || 'n/a'} deg`);
  lines.push(`- ENLIL runs: ${enlil.length}`);
  lines.push(`- IP shocks: ${ips.length}`);
  lines.push(`- GSTs: ${gst.length}`);
  return lines.join('\n');
}
async function buildStormPayload(activityId) {
  const window = windowFromActivityId(activityId);
  const params = { startDate: window.startDate, endDate: window.endDate };
  const [cmes, enlilAll, ipsAll, gstAll] = await Promise.all([
    fetchDONKI('CME', params),
    fetchDONKI('WSAEnlilSimulations', params).catch(() => []),
    fetchDONKI('IPS', params).catch(() => []),
    fetchDONKI('GST', params).catch(() => []),
  ]);
  const cme = cmes.find(c => c.activityID === activityId) || null;
  const analyses = Array.isArray(cme?.cmeAnalyses) ? cme.cmeAnalyses : [];
  const enlil = enlilAll.filter(s => enlilUses(s, activityId) || hasLinked(s, activityId));
  const ips = ipsAll.filter(s => hasLinked(s, activityId));
  const gst = gstAll.filter(g => hasLinked(g, activityId));
  return { ok:true, activityID: activityId, window, cme, analyses, enlil, ips, gst, notes: [] };
}

/* --------------------------------- EONET ---------------------------------- */
async function fetchEONET(pathOrUrl, params = {}) {
  const url = pathOrUrl.startsWith('http') ? new URL(pathOrUrl) : new URL(`${EONET_ORIGIN}/${pathOrUrl.replace(/^\//,'')}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const r = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`EONET ${url.pathname} ${r.status}`);
  return r.json();
}
function eventWindowFromGeometry(geom = []) {
  const times = geom.map(g => Date.parse(g.date)).filter(Number.isFinite).sort((a,b)=>a-b);
  if (!times.length) return null;
  const iso = (ms) => new Date(ms).toISOString();
  return { start: iso(times[0]), end: iso(times[times.length - 1]) };
}
function toEventMarkdown(ev) {
  const fmt = (d) => d ? String(d).replace('T',' ').replace('Z',' UTC') : 'n/a';
  const title = ev.title || `EONET Event ${ev.id}`;
  const catNames = (ev.categories||[]).map(c => c.title).join(', ');
  const status = ev.closed ? 'closed' : 'open';
  const w = eventWindowFromGeometry(ev.geometry||[]) || {};
  const lines = [];
  lines.push(`# Event: ${title}`);
  lines.push(`ID: ${ev.id}  Status: ${status}`);
  if (catNames) lines.push(`Categories: ${catNames}`);
  if (w.start || w.end) lines.push(`Active window: ${fmt(w.start)} -> ${fmt(w.end)}`);
  if (ev.link) lines.push(`Source: ${ev.link}`);
  return lines.join('\n');
}

/* --------------------------------- Router --------------------------------- */
async function handle(event) {
  const req = event.request;
  const u = new URL(req.url);
  const origin = req.headers.get('Origin') || '*';

  // The site is served from this Worker's static assets and calls the API under
  // /api/*; the bare paths still answer for older callers.
  if (u.pathname === '/api' || u.pathname.startsWith('/api/')) {
    u.pathname = u.pathname.slice(4) || '/';
  }

  if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:{ ...sec(), ...cors(origin) } });
  if (u.pathname === '/favicon.ico') return new Response(null, { status:204, headers:{ ...sec(), ...cors(origin) } });

  if (u.pathname === '/' || u.pathname === '') {
    return json(200, {
      ok:true, runtime:'service-worker',
      routes: [
        '/apod?date=YYYY-MM-DD',
        '/neo/browse?size=5',
        '/neo/feed?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD',
        '/mars/curiosity/photos?earth_date=YYYY-MM-DD',
        '/epic/natural?date=YYYY-MM-DD',
        '/images/search?q=apollo&media_type=image',
        '/nasa/planetary/apod?date=YYYY-MM-DD',
        '/storm/find?start=YYYY-MM-DD&end=YYYY-MM-DD',
        '/storm/{activityID}.json',
        '/storm/{activityID}.md',
        '/eonet/events?status=open&limit=50',
        '/eonet/categories',
        '/event/{eonetEventId}.md',
        '/sbdb/search?q=1&limit=50',
        '/sbdb/suggest?q=cer',
        '/sbdb/object?sstr=433',
        "/horizons?COMMAND='499'&EPHEM_TYPE=ELEMENTS&TLIST='2025-11-19%2004:00:02'",
        '/tle/search?q=ISS',
        '/tle/25544',
        '/exo/tap?adql=SELECT%20TOP%2010%20pl_name%20FROM%20ps'
      ]
    }, origin);
  }

  if (u.pathname === '/diag') {
    const key = (typeof NASA_API !== 'undefined' && NASA_API) ? String(NASA_API) : '';
    return json(200, {
      ok:true,
      runtime:'service-worker',
      hasNASA_API:key.length>0,
      keyLen:key.length,
      now:new Date().toISOString(),
      indexBase: INDEX_BASE
    }, origin);
  }

  // DONKI CME: list CMEs in a date range (storm.html "Find CMEs by date")
  if (u.pathname === '/storm/find') {
    requireApi(origin);
    const start = String(u.searchParams.get('start') || u.searchParams.get('startDate') || '').trim();
    const end   = String(u.searchParams.get('end') || u.searchParams.get('endDate') || '').trim();
    if (!isIsoDay(start) || !isIsoDay(end)) {
      return json(400, { ok:false, message:'Provide start and end as YYYY-MM-DD' }, origin);
    }
    try {
      const cmes = await fetchDONKI('CME', { startDate: start, endDate: end });
      const items = cmes
        .filter(c => c && c.activityID)
        .map(c => ({
          activityID: c.activityID,
          startTime: c.startTime || null,
          sourceLocation: c.sourceLocation || null,
          activeRegionNum: c.activeRegionNum || null,
          note: c.note ? String(c.note).slice(0, 200) : ''
        }));
      return json(200, { ok:true, start, end, count: items.length, items }, origin,
        { 'Cache-Control':'public, max-age=300, stale-while-revalidate=3600' });
    } catch (e) {
      return json(502, { ok:false, message:'DONKI upstream error', error:scrub(e) }, origin);
    }
  }

  // DONKI CME: joined report for one activity ID — /storm/{activityID}.json | .md
  {
    const m = u.pathname.match(/^\/storm\/(.+)\.(json|md)$/);
    if (m) {
      requireApi(origin);
      const activityId = decodeURIComponent(m[1]);
      const wantMd = m[2] === 'md';
      try {
        const payload = await buildStormPayload(activityId);
        if (!payload.cme) {
          return wantMd
            ? markdown(404, `# CME Explorer: ${activityId}\n\nNo CME found for this Activity ID.`, origin)
            : json(404, { ok:false, message:`No CME found for activity ID ${activityId}` }, origin);
        }
        const cacheHdr = { 'Cache-Control':'public, max-age=300, stale-while-revalidate=3600' };
        return wantMd
          ? markdown(200, toStormMarkdown(activityId, payload), origin, cacheHdr)
          : json(200, payload, origin, cacheHdr);
      } catch (e) {
        return json(502, { ok:false, message:'DONKI upstream error', error:scrub(e) }, origin);
      }
    }
  }

  // EONET event detail as markdown — /event/{id}.md
  {
    const m = u.pathname.match(/^\/event\/(.+)\.md$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      try {
        const ev = await fetchEONET(`events/${encodeURIComponent(id)}`);
        return markdown(200, toEventMarkdown(ev), origin,
          { 'Cache-Control':'public, max-age=300, stale-while-revalidate=3600' });
      } catch (e) {
        const notFound = /404/.test(String(e));
        return json(notFound ? 404 : 502, { ok:false, message:'EONET upstream error', error:scrub(e) }, origin);
      }
    }
  }

  // EONET passthrough — /eonet/events, /eonet/categories, etc.
  if (u.pathname.startsWith('/eonet/')) {
    const path = u.pathname.replace(/^\/eonet\/?/, '');
    const t = new URL(`${EONET_ORIGIN}/${path}`);
    for (const [k, v] of u.searchParams) t.searchParams.set(k, v);
    return xfer(t, origin, { cacheOK:true, diagHeader:'x-upstream-eonet', init:{ method:'GET' }, timeoutMs: 10000 }, event);
  }

  // Horizons (keyless)
  if (u.pathname === '/horizons') {
    const allow = new Set([
      'COMMAND','EPHEM_TYPE','CENTER','REF_PLANE','REF_SYSTEM','MAKE_EPHEM','OUT_UNITS',
      'format','FORMAT','START_TIME','STOP_TIME','STEP_SIZE','TLIST','TLIST_TYPE','OBJ_DATA',
      'CSV_FORMAT','VEC_TABLE','VEC_CORR','TIME','TIME_TYPE','TIME_DIGITS',
    ]);
    const upstream = new URL(HORIZONS_ORIGIN);
    for (const [k, v] of u.searchParams) if (allow.has(k)) upstream.searchParams.append(k, v);

    if (!upstream.searchParams.has('TLIST') && u.searchParams.has('TIME')) {
      let raw = u.searchParams.get('TIME') || '';
      raw = raw.replace(/^'+|'+$/g,'');
      const norm = raw.replace('T',' ').replace(/Z$/i,'');
      upstream.searchParams.set('TLIST', `'${norm}'`);
      if (!upstream.searchParams.has('TIME_TYPE')) upstream.searchParams.set('TIME_TYPE','UT');
    }

    if (!upstream.searchParams.has('format') && !upstream.searchParams.has('FORMAT')) upstream.searchParams.set('format','json');
    if (!upstream.searchParams.has('MAKE_EPHEM')) upstream.searchParams.set('MAKE_EPHEM','YES');
    if (!upstream.searchParams.has('OBJ_DATA')) upstream.searchParams.set('OBJ_DATA','NO');
    if (!upstream.searchParams.has('EPHEM_TYPE')) upstream.searchParams.set('EPHEM_TYPE','ELEMENTS');
    if (!upstream.searchParams.has('CENTER')) upstream.searchParams.set('CENTER','500@10');
    if (!upstream.searchParams.has('REF_PLANE')) upstream.searchParams.set('REF_PLANE','ECLIPTIC');
    if (!upstream.searchParams.has('REF_SYSTEM')) upstream.searchParams.set('REF_SYSTEM','J2000');
    if (!upstream.searchParams.has('OUT_UNITS')) upstream.searchParams.set('OUT_UNITS','AU-D');
    if (!upstream.searchParams.has('COMMAND')) return json(400, { ok:false, message:'Missing COMMAND' }, origin);
    return xfer(upstream, origin, { cacheOK:true, diagHeader:'x-upstream-horizons', init:{ method:'GET' }, timeoutMs: 10000 }, event);
  }

  // SBDB single-object passthrough (raw)
  if (u.pathname === '/sbdb') {
    const upstream = new URL(SBDB_OBJECT_ORIGIN);
    for (const [k, v] of u.searchParams) upstream.searchParams.append(k, v);
    return xfer(upstream, origin, { cacheOK:true, diagHeader:'x-upstream-sbdb', init:{ method:'GET' }, timeoutMs: SBDB_GET_TIMEOUT_MS }, event);
  }

  // SBDB object resolve (robust)
  if (u.pathname === '/sbdb/object') {
    const sstr = u.searchParams.get('sstr') || u.searchParams.get('des') || u.searchParams.get('q') || '';
    if (!sstr) return json(400, { ok:false, message:'Provide sstr|des|q' }, origin);
    const out = await runObjectResolve(sstr, origin, event);
    return json(out.ok ? 200 : 502, out, origin, { 'Cache-Control':'public, max-age=600' });
  }

  // SBDB suggest (typeahead) via local shards
  if (u.pathname === '/sbdb/suggest') {
    const q = u.searchParams.get('q') || '';
    if (!q.trim()) return json(400, { ok:false, message:'Provide q' }, origin);
    const out = await runSuggest(q, origin, event);
    return json(200, out, origin, { 'Cache-Control':'public, max-age=600, stale-while-revalidate=86400' });
  }

  // SBDB search (Google-like) via local file shards
  if (u.pathname === '/sbdb/search') {
    const q = (u.searchParams.get('q') || '').trim();
    if (!q) return json(400, { ok:false, message:'Provide q' }, origin);

    const types = (u.searchParams.get('types') || 'all').toLowerCase();
    const limit = clamp(toIntOr(SEARCH_DEFAULT_LIMIT, u.searchParams.get('limit')), 1, SEARCH_MAX_LIMIT);
    const page  = Math.max(1, toIntOr(SEARCH_DEFAULT_PAGE, u.searchParams.get('page')));

    const isNumberOnly = /^\d+$/.test(q);
    const isNameLike   = /[a-z]/i.test(q) && !isNumberOnly;
    const mode = isNameLike ? 'contains' : 'prefix';

    const out = await searchIndexFiles(q, { mode, types, limit, page }, origin, event);
    const nextPage = (page * limit) < out.total ? page + 1 : null;

    return json(200, {
      ok:true,
      intent: isNumberOnly ? 'pdes' : (isNameLike ? 'name' : 'mixed'),
      q,
      qCore: q,
      qmode: mode,
      page,
      limit,
      total: out.total,
      nextPage,
      items: out.items,
      debug: { indexBase: INDEX_BASE, shards: out.shardUrls }
    }, origin, { 'Cache-Control':'public, max-age=300, stale-while-revalidate=86400' });
  }

  // APOD
  if (u.pathname === '/apod') {
    requireApi(origin);
    const t = new URL(`${API_ORIGIN}/planetary/apod`);
    for (const [k, v] of u.searchParams) t.searchParams.set(k, v);
    t.searchParams.set('api_key', NASA_API);
    return xfer(t, origin, { cacheOK:true, init:{ method:'GET' }, timeoutMs: 6000 }, event);
  }

  // NEO (NeoWs). Note: feed lives at /neo/rest/v1/feed, everything else under /neo/rest/v1/neo/
  if (u.pathname.startsWith('/neo/')) {
    requireApi(origin);
    const rel = u.pathname.replace(/^\/neo\/?/, '');
    const upstreamPath = rel === 'feed' ? 'feed' : `neo/${rel}`;
    const t = new URL(`${API_ORIGIN}/neo/rest/v1/${upstreamPath}`);
    for (const [k, v] of u.searchParams) t.searchParams.set(k, v);
    t.searchParams.set('api_key', NASA_API);
    return xfer(t, origin, { cacheOK:false, diagHeader:'x-upstream-neo', init:{ method:'GET' }, timeoutMs: 8000 }, event);
  }

  // Mars Photos
  if (u.pathname.startsWith('/mars/')) {
    requireApi(origin);
    const [, , rover, tail] = u.pathname.split('/');
    const roverId = rover || 'curiosity';
    const resource = tail || 'photos';
    const t = new URL(`${API_ORIGIN}/mars-photos/api/v1/rovers/${encodeURIComponent(roverId)}/${resource}`);
    for (const [k, v] of u.searchParams) t.searchParams.set(k, v);
    t.searchParams.set('api_key', NASA_API);
    return xfer(t, origin, { cacheOK:false, init:{ method:'GET' }, timeoutMs: 10000 }, event);
  }

  // EPIC
  if (u.pathname.startsWith('/epic/')) {
    requireApi(origin);
    const path = u.pathname.replace(/^\/epic\/?/, '');
    const t = new URL(`${API_ORIGIN}/EPIC/api/${path}`);
    for (const [k, v] of u.searchParams) t.searchParams.set(k, v);
    t.searchParams.set('api_key', NASA_API);
    return xfer(t, origin, { cacheOK:false, init:{ method:'GET' }, timeoutMs: 10000 }, event);
  }

  // NASA Images (keyless)
  if (u.pathname.startsWith('/images/')) {
    const path = u.pathname.replace(/^\/images\/?/, '');
    const t = new URL(`${IMAGES_ORIGIN}/${path}`);
    for (const [k, v] of u.searchParams) t.searchParams.set(k, v);
    return xfer(t, origin, { cacheOK:true, init:{ method:'GET' }, timeoutMs: 8000 }, event);
  }

  // Raw /nasa/*
  if (u.pathname.startsWith('/nasa/')) {
    requireApi(origin);
    const path = u.pathname.replace(/^\/nasa\/?/, '');
    const t = new URL(`${API_ORIGIN}/${path}`);
    for (const [k, v] of u.searchParams) t.searchParams.set(k, v);
    t.searchParams.set('api_key', NASA_API);
    return xfer(t, origin, { cacheOK:false, init:{ method:'GET' }, timeoutMs: 10000 }, event);
  }

  // TLE
  if (u.pathname === '/tle/search') {
    const q = u.searchParams.get('q') || '';
    const upstream = new URL(`${TLE_ORIGIN}/tle`);
    if (q) upstream.searchParams.set('search', q);
    return xfer(upstream, origin, { cacheOK:true, diagHeader:'x-upstream-tle', init:{ method:'GET' }, timeoutMs: 6000 }, event);
  }
  if (u.pathname.startsWith('/tle/')) {
    const id = u.pathname.replace(/^\/tle\/?/, '');
    const upstream = new URL(`${TLE_ORIGIN}/tle/${encodeURIComponent(id)}`);
    return xfer(upstream, origin, { cacheOK:true, diagHeader:'x-upstream-tle', init:{ method:'GET' }, timeoutMs: 6000 }, event);
  }

  // Exoplanet Archive TAP proxy
  if (u.pathname === '/exo/tap' || u.pathname === '/exoplanet/tap') {
    const fmt = (u.searchParams.get('format') || 'json').toLowerCase();

    if (req.method === 'POST') {
      const ct = req.headers.get('content-type') || '';
      let adql = '';
      if (ct.includes('application/json')) {
        const body = await req.json().catch(()=> ({}));
        adql = String(body.adql || body.query || '');
      } else {
        const raw = await req.text();
        const formIn = new URLSearchParams(raw);
        adql = String(formIn.get('adql') || formIn.get('query') || '');
      }
      if (!adql.trim()) return json(400, { ok:false, message:'Provide adql|query in body' }, origin);

      const form = new URLSearchParams();
      form.set('request', 'doQuery');
      form.set('lang', 'ADQL');
      form.set('format', fmt);
      form.set('query', adql);

      const init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      };
      return xfer(EXO_TAP_SYNC, origin, { cacheOK: true, diagHeader: 'x-upstream-exo', init, timeoutMs: 20000 }, event);
    }

    const adql = u.searchParams.get('adql') || u.searchParams.get('q') || u.searchParams.get('query') || '';
    if (!adql.trim()) return json(400, { ok:false, message:'Provide adql|q|query' }, origin);

    const upstream = tapURL(adql, fmt);
    upstream.searchParams.set('request', 'doQuery');
    upstream.searchParams.set('lang', 'ADQL');
    return xfer(upstream, origin, { cacheOK: true, diagHeader: 'x-upstream-exo', init: { method: 'GET' }, timeoutMs: 20000 }, event);
  }

  return json(404, { ok:false, message:'Not Found', path:u.pathname, hint:'See / for routes; /diag for bindings' }, origin);
}
