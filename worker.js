const NASA_HOST = 'api.nasa.gov';
const NASA_BASE = `https://${NASA_HOST}`;
const API_ORIGIN = NASA_BASE;
const JPL_SSD_BASE = 'https://ssd-api.jpl.nasa.gov';
const EONET_BASE = 'https://eonet.gsfc.nasa.gov/api/v3';
const EXOPLANET_ARCHIVE_BASE = 'https://exoplanetarchive.ipac.caltech.edu';
const EXOPLANET_TAP_PATH = '/TAP/sync';
const TLE_API_BASE = 'https://tle.ivanstanojevic.me/api/tle';
const DEMO_KEY = 'DEMO_KEY';

let NASA_API = '';

function secHeaders() {
  return {
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

function corsHeaders(origin) {
  const allowOrigin = origin || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function redactKey(u) {
  const copy = new URL(u.toString());
  if (copy.searchParams.has('api_key')) copy.searchParams.set('api_key', '***');
  return copy.toString();
}

function activeApiKey(key) {
  if (key && typeof key === 'string' && key.trim().length) {
    return key.trim();
  }
  return DEMO_KEY;
}

function forceApiKey(u, key) {
  if (u.host === NASA_HOST) {
    const value = activeApiKey(key);
    u.searchParams.delete('api_key');
    if (value) {
      u.searchParams.set('api_key', value);
    }
    return value;
  }
  return '';
}

function jsonResponse(body, status, origin, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...secHeaders(),
    ...corsHeaders(origin),
    ...extraHeaders,
  };
  return new Response(JSON.stringify(body), { status, headers });
}

function buildExoplanetTapTarget(url) {
  const adql = url.searchParams.get('adql') || url.searchParams.get('query');
  if (!adql || !adql.trim()) {
    return { error: 'Missing ADQL query' };
  }
  const target = new URL(EXOPLANET_TAP_PATH, EXOPLANET_ARCHIVE_BASE);
  target.searchParams.set('request', url.searchParams.get('request') || 'doQuery');
  target.searchParams.set('format', url.searchParams.get('format') || 'json');
  target.searchParams.set('query', adql);
  const passthrough = ['maxrec', 'phase', 'lang'];
  for (const key of passthrough) {
    const value = url.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return { url: target };
}

async function fwd(target, request, origin, debug, cf, extraHeaders = {}) {
  const fetchInit = cf ? { cf } : undefined;

  const performFetch = async (url, apiKeyHeader) => {
    const headers = new Headers({
      'User-Agent': 'cf-worker-nasa-proxy',
      Accept: 'application/json, image/*, */*;q=0.1',
    });
    if (apiKeyHeader) {
      headers.set('x-api-key', apiKeyHeader);
    }
    const outReq = new Request(url.toString(), {
      method: 'GET',
      headers,
    });
    return fetch(outReq, fetchInit);
  };

  const initialKey = forceApiKey(target, NASA_API);
  let effectiveUrl = target;
  let resp = await performFetch(target, target.host === NASA_HOST ? initialKey : '');

  const configuredKey = (NASA_API || '').trim();
  const hasConfiguredKey = configuredKey.length > 0 && configuredKey !== DEMO_KEY;
  if (resp.status === 401 && target.host === NASA_HOST && hasConfiguredKey) {
    const fallbackUrl = new URL(target.toString());
    const fallbackKey = forceApiKey(fallbackUrl, '');
    const retry = await performFetch(
      fallbackUrl,
      fallbackUrl.host === NASA_HOST ? fallbackKey : '',
    );
    if (retry.status < 500 || retry.status === 401) {
      resp = retry;
      effectiveUrl = fallbackUrl;
    }
  }

  const headers = { ...secHeaders(), ...corsHeaders(origin), ...extraHeaders };
  if (debug) headers['x-upstream-url-redacted'] = redactKey(effectiveUrl);

  const contentType = resp.headers.get('Content-Type') || 'application/octet-stream';
  if (contentType) headers['Content-Type'] = contentType;

  if (!('Cache-Control' in headers)) {
    const cacheControl = resp.headers.get('Cache-Control');
    if (cacheControl) headers['Cache-Control'] = cacheControl;
  }

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

function formatCardinalCoordinate(value, pos, neg) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const direction = n >= 0 ? pos : neg;
  return `${Math.abs(n).toFixed(2)}°${direction}`;
}

function describeCoordinates(raw) {
  if (!Array.isArray(raw)) return null;
  if (raw.length >= 2 && typeof raw[0] === 'number' && typeof raw[1] === 'number') {
    const lon = formatCardinalCoordinate(raw[0], 'E', 'W');
    const lat = formatCardinalCoordinate(raw[1], 'N', 'S');
    if (lon && lat) return `${lat}, ${lon}`;
  }
  if (
    Array.isArray(raw[0]) &&
    Array.isArray(raw[0][0]) &&
    typeof raw[0][0][0] === 'number' &&
    typeof raw[0][0][1] === 'number'
  ) {
    return describeCoordinates(raw[0][0]);
  }
  return null;
}

function buildEventMarkdown(event) {
  const lines = [];
  const id = event?.id || 'EONET Event';
  const title = event?.title || id;
  lines.push(`# ${title}`);

  const description = typeof event?.description === 'string' ? event.description.trim() : '';
  if (description) {
    lines.push('', description);
  }

  const closed = event?.closed;
  const status = closed ? `Closed ${closed}` : 'Open';
  lines.push('', `**Status:** ${status}`);

  const categories = Array.isArray(event?.categories)
    ? event.categories.map((c) => c?.title || c?.id).filter(Boolean)
    : [];
  if (categories.length) {
    lines.push('', `**Categories:** ${categories.join(', ')}`);
  }

  const latest = Array.isArray(event?.geometry) && event.geometry.length
    ? event.geometry[event.geometry.length - 1]
    : null;
  if (latest) {
    if (latest.date) {
      lines.push('', `**Latest Update:** ${latest.date}`);
    }
    const coords = describeCoordinates(latest.coordinates);
    if (coords) {
      lines.push('', `**Coordinates:** ${coords}`);
    }
    if (latest.magnitudeValue !== undefined) {
      const magUnits = latest.magnitudeUnit ? ` ${latest.magnitudeUnit}` : '';
      lines.push('', `**Magnitude:** ${latest.magnitudeValue}${magUnits}`);
    }
  }

  if (event?.link) {
    lines.push('', `[View on EONET](${event.link})`);
  }

  const sources = Array.isArray(event?.sources) ? event.sources : [];
  if (sources.length) {
    lines.push('', '## Sources');
    for (const source of sources.slice(0, 10)) {
      const label = source?.id || source?.source || 'Source';
      if (source?.url) {
        lines.push(`- [${label}](${source.url})`);
      } else {
        lines.push(`- ${label}`);
      }
    }
  }

  if (Array.isArray(event?.geometry) && event.geometry.length) {
    lines.push('', '## Geometry Timeline');
    const maxEntries = 10;
    const recent = event.geometry.slice(-maxEntries).reverse();
    for (const entry of recent) {
      const when = entry.date || 'Unknown date';
      const coords = describeCoordinates(entry.coordinates);
      const location = coords ? coords : entry.type || 'Location unavailable';
      lines.push(`- ${when} — ${location}`);
    }
  }

  return lines.join('\n');
}

async function fetchTle(upstream, origin) {
  const headers = { ...secHeaders(), ...corsHeaders(origin) };
  try {
    const resp = await fetch(upstream.toString(), { cf: { cacheEverything: true, cacheTtl: 300 } });
    const text = await resp.text();
    headers['Content-Type'] = resp.headers.get('content-type') || 'application/json; charset=utf-8';
    if (resp.ok) {
      headers['Cache-Control'] = 'public, max-age=120, s-maxage=300, stale-while-revalidate=3600';
    }
    return new Response(text, { status: resp.status, headers });
  } catch (error) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    return new Response(
      JSON.stringify({ error: 'TLE fetch failed', url: upstream.toString() }),
      { status: 502, headers },
    );
  }
}

async function proxyEonet(path, url, origin) {
  const target = new URL(path, EONET_BASE);
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'debug') continue;
    target.searchParams.append(key, value);
  }

  try {
    const resp = await fetch(target.toString(), { cf: { cacheEverything: true, cacheTtl: 600 } });
    const text = await resp.text();
    const headers = {
      ...secHeaders(),
      ...corsHeaders(origin),
      'Content-Type': resp.headers.get('content-type') || 'application/json; charset=utf-8',
    };
    if (resp.ok) {
      headers['Cache-Control'] = 'public, max-age=300, s-maxage=600';
    }
    return new Response(text, { status: resp.status, headers });
  } catch (error) {
    const headers = { ...secHeaders(), ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' };
    return new Response(JSON.stringify({ error: 'EONET fetch failed', url: target.toString() }), {
      status: 502,
      headers,
    });
  }
}

function mapWorkerPath(pathname) {
  if (pathname === '/epic') {
    return '/EPIC/api';
  }
  if (pathname.startsWith('/epic/')) {
    const remainder = pathname.slice('/epic/'.length);
    if (remainder.startsWith('archive/')) {
      return `/EPIC/${remainder}`;
    }
    return `/EPIC/api/${remainder}`;
  }
  return pathname;
}

function mapCustomTarget(url) {
  if (url.pathname === '/cad.api' || url.pathname === '/sbdb_query.api') {
    return { base: JPL_SSD_BASE, pathname: url.pathname };
  }
  return { base: NASA_BASE, pathname: mapWorkerPath(url.pathname) };
}

function buildTargetUrl(url) {
  const { base, pathname } = mapCustomTarget(url);
  const target = new URL(pathname, base);
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'debug' || key === 'api_key') continue;
    target.searchParams.set(key, value);
  }
  return target;
}

function methodNotAllowed(origin) {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { ...secHeaders(), ...corsHeaders(origin) },
  });
}

function optionsResponse(origin, request) {
  const headers = { ...secHeaders(), ...corsHeaders(origin) };
  const acrh = request.headers.get('Access-Control-Request-Headers');
  if (acrh) headers['Access-Control-Allow-Headers'] = acrh;
  return new Response(null, { status: 204, headers });
}

async function handleRequest(request) {
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') return optionsResponse(origin, request);
  if (request.method !== 'GET') return methodNotAllowed(origin);

  const url = new URL(request.url);
  const debug = url.searchParams.get('debug') === '1';

  if (url.pathname === '/health') {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders(), ...corsHeaders(origin) };
    headers['Cache-Control'] = 'public, max-age=300, s-maxage=600';
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (url.pathname === '/diag') {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders(), ...corsHeaders(origin) };
    const key = typeof NASA_API === 'string' ? NASA_API.trim() : '';
    const info = {
      hasNASA_API: key.length > 0,
      keyLength: key.length,
      usingDemoKey: key.length === 0,
    };
    return new Response(JSON.stringify(info), { status: 200, headers });
  }

  if (url.pathname === '/tle/search') {
    const query = (url.searchParams.get('q') || '').trim();
    if (!query) {
      return jsonResponse({ member: [] }, 200, origin, {
        'Cache-Control': 'public, max-age=60, s-maxage=120',
      });
    }
    const upstream = new URL(TLE_API_BASE);
    upstream.searchParams.set('search', query);
    const limit = url.searchParams.get('limit');
    if (limit) upstream.searchParams.set('limit', limit);
    const page = url.searchParams.get('page');
    if (page) upstream.searchParams.set('page', page);
    return fetchTle(upstream, origin);
  }

  if (url.pathname.startsWith('/tle/')) {
    const idPart = url.pathname.slice('/tle/'.length);
    if (!idPart) {
      return jsonResponse({ error: 'Missing satellite id' }, 400, origin);
    }
    const upstream = new URL(`${encodeURIComponent(idPart)}`, `${TLE_API_BASE}/`);
    return fetchTle(upstream, origin);
  }

  if (url.pathname === '/exo/tap') {
    const target = buildExoplanetTapTarget(url);
    if (target.error) {
      return jsonResponse({ ok: false, message: target.error }, 400, origin);
    }
    const cf = { cacheEverything: true, cacheTtl: 300 };
    const headers = {
      'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=86400',
    };
    return fwd(target.url, request, origin, debug, cf, headers);
  }

  if (url.pathname.startsWith('/exo/')) {
    return jsonResponse(
      { ok: false, message: 'Not Found', path: url.pathname, hint: 'See / for routes; /diag for bindings' },
      404,
      origin,
    );
  }

  // APOD
  if (url.pathname === '/apod') {
    const target = new URL('/planetary/apod' + url.search, API_ORIGIN);
    target.searchParams.delete('debug');
    const cf = { cacheEverything: true, cacheTtl: 600 }; // 10 min edge cache
    const headers = {
      'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400',
    };
    return fwd(target, request, origin, debug, cf, headers);
  }

  if (url.pathname === '/eonet/events') {
    return proxyEonet('/events', url, origin);
  }

  if (url.pathname === '/eonet/categories') {
    return proxyEonet('/categories', url, origin);
  }

  if (url.pathname.startsWith('/event/') && url.pathname.endsWith('.md')) {
    const slug = url.pathname.slice('/event/'.length, -'.md'.length);
    const eventId = decodeURIComponent(slug);
    const target = new URL(`/events/${encodeURIComponent(eventId)}`, EONET_BASE);
    try {
      const resp = await fetch(target.toString(), { cf: { cacheEverything: true, cacheTtl: 600 } });
      if (!resp.ok) {
        const headers = { ...secHeaders(), ...corsHeaders(origin), 'Content-Type': 'text/plain; charset=utf-8' };
        return new Response(`Unable to load event ${eventId}`, { status: resp.status, headers });
      }
      const data = await resp.json();
      const markdown = buildEventMarkdown(data);
      const headers = {
        ...secHeaders(),
        ...corsHeaders(origin),
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      };
      return new Response(markdown, { status: 200, headers });
    } catch (error) {
      const headers = { ...secHeaders(), ...corsHeaders(origin), 'Content-Type': 'text/plain; charset=utf-8' };
      return new Response('Failed to contact EONET service', { status: 502, headers });
    }
  }

  if (url.pathname === '/horizons') {
    const base = new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
    const allow = new Set([
      'COMMAND',
      'EPHEM_TYPE',
      'CENTER',
      'REF_PLANE',
      'REF_SYSTEM',
      'MAKE_EPHEM',
      'OUT_UNITS',
      'FORMAT',
      'START_TIME',
      'STOP_TIME',
      'STEP_SIZE',
      'TIME',
      'TLIST',
      'TLIST_TYPE',
      'OBJ_DATA',
      'CSV_FORMAT',
      'VEC_TABLE',
      'VEC_CORR',
      'TIME_TYPE',
      'TIME_DIGITS',
    ]);
    let forwarded = 0;
    for (const [key, value] of url.searchParams) {
      if (key === 'debug') continue;
      if (allow.has(key)) {
        base.searchParams.append(key, value);
        forwarded += 1;
      }
    }
    const baseHeaders = { ...secHeaders(), 'Access-Control-Allow-Origin': '*', Vary: 'Origin' };
    if (forwarded === 0) {
      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        ...baseHeaders,
      };
      return new Response(JSON.stringify({ ok: false, message: 'no valid Horizons params' }), {
        status: 400,
        headers,
      });
    }
    if (!base.searchParams.has('FORMAT')) base.searchParams.set('FORMAT', 'JSON');
    if (!base.searchParams.has('MAKE_EPHEM')) base.searchParams.set('MAKE_EPHEM', 'YES');
    if (!base.searchParams.has('OBJ_DATA')) base.searchParams.set('OBJ_DATA', 'NO');
    if (!base.searchParams.has('EPHEM_TYPE')) base.searchParams.set('EPHEM_TYPE', 'ELEMENTS');
    if (!base.searchParams.has('CENTER')) base.searchParams.set('CENTER', '500@10');
    if (!base.searchParams.has('REF_PLANE')) base.searchParams.set('REF_PLANE', 'ECLIPTIC');
    if (!base.searchParams.has('REF_SYSTEM')) base.searchParams.set('REF_SYSTEM', 'J2000');
    if (!base.searchParams.has('OUT_UNITS')) base.searchParams.set('OUT_UNITS', 'AU-D');
    const cf = { cacheEverything: true, cacheTtl: 600 };
    try {
      const r = await fetch(base.toString(), { cf });
      if (!r.ok) {
        const errorHeaders = {
          'Content-Type': 'application/json',
          ...baseHeaders,
        };
        return new Response(
          JSON.stringify({ ok: false, status: r.status, url: base.toString() }),
          { status: r.status, headers: errorHeaders },
        );
      }
      const body = await r.text();
      const successHeaders = {
        'Content-Type': r.headers.get('content-type') || 'application/json; charset=utf-8',
        ...baseHeaders,
      };
      return new Response(body, { status: 200, headers: successHeaders });
    } catch (err) {
      const errorHeaders = {
        'Content-Type': 'application/json',
        ...baseHeaders,
      };
      return new Response(
        JSON.stringify({ ok: false, status: 502, url: base.toString() }),
        { status: 502, headers: errorHeaders },
      );
    }
  }

  if (url.pathname === '/sbdb') {
    const base = new URL('https://ssd-api.jpl.nasa.gov/sbdb.api');
    for (const [key, value] of url.searchParams.entries()) {
      base.searchParams.append(key, value);
    }
    const headers = { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders(), ...corsHeaders(origin) };
    const cacheOpts = { cacheEverything: true, cacheTtl: 600 };

    const attempts = [];
    const seen = new Set();
    const pushAttempt = (candidate) => {
      const key = candidate.toString();
      if (seen.has(key)) return;
      seen.add(key);
      attempts.push(candidate);
    };
    pushAttempt(base);

    const requested = url.searchParams.get('sstr') || '';
    const normalized = requested.replace(/\s+/g, '').toUpperCase();
    if (normalized.includes('3I')) {
      const aliases = [
        'C/2025 N1 (ATLAS)',
        '3I/2025 N1 (ATLAS)',
        '2025 N1 (ATLAS)',
        '2025 N1',
        '3I/2019 N2 (ATLAS)',
        '2019 N2',
        '3I',
      ];
      for (const alias of aliases) {
        const alt = new URL('https://ssd-api.jpl.nasa.gov/sbdb.api');
        for (const [key, value] of url.searchParams.entries()) {
          if (key === 'sstr') continue;
          alt.searchParams.append(key, value);
        }
        alt.searchParams.set('sstr', alias);
        pushAttempt(alt);
      }
    }

    for (const attempt of attempts) {
      try {
        const resp = await fetch(attempt.toString(), { cf: cacheOpts });
        const text = await resp.text();
        if (resp.status === 404) {
          continue;
        }
        const mergedHeaders = {
          ...headers,
          'Content-Type': resp.headers.get('content-type') || headers['Content-Type'],
        };
        return new Response(text, { status: resp.status, headers: mergedHeaders });
      } catch (error) {
        if (attempt !== attempts[attempts.length - 1]) {
          continue;
        }
        return new Response(JSON.stringify({ error: 'SBDB fetch failed', url: attempt.toString() }), {
          status: 502,
          headers,
        });
      }
    }

    return new Response(
      JSON.stringify({ error: 'SBDB object not found', attempts: attempts.map(u => u.searchParams.get('sstr')) }),
      { status: 404, headers },
    );
  }

  if (url.pathname === '/cad.api' || url.pathname === '/sbdb_query.api') {
    const upstream = new URL(url.pathname, JPL_SSD_BASE);
    for (const [key, value] of url.searchParams.entries()) {
      if (key === 'debug') continue;
      upstream.searchParams.append(key, value);
    }
    const headers = { 'Content-Type': 'application/json; charset=utf-8', ...secHeaders(), ...corsHeaders(origin) };
    try {
      const resp = await fetch(upstream.toString());
      const text = await resp.text();
      const mergedHeaders = {
        ...headers,
        'Content-Type': resp.headers.get('content-type') || headers['Content-Type'],
      };
      return new Response(text, { status: resp.status, headers: mergedHeaders });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'upstream fetch failed' }), {
        status: 502,
        headers,
      });
    }
  }

  const target = buildTargetUrl(url);

  return fwd(target, request, origin, debug);
}

export default {
  async fetch(request, env) {
    NASA_API = env?.NASA_API || '';
    return handleRequest(request);
  },
};
